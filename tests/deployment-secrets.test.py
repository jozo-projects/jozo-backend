import pathlib
import base64
import os
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class DeploymentSecretsTest(unittest.TestCase):
    def test_env_files_excluded_from_build_context(self):
        path = ROOT / '.dockerignore'
        patterns = path.read_text().splitlines() if path.exists() else []
        self.assertIn('.env', patterns)
        self.assertIn('.env.*', patterns)
        self.assertNotIn('!.env.local', patterns)
        self.assertNotIn('!.env.production', patterns)

    def test_deployment_supplies_runtime_environment_before_stopping_old_container(self):
        workflow = (ROOT / '.github/workflows/ci-cd.yml').read_text()
        self.assertIn('ENV_FILE_CONTENT: ${{ secrets.ENV_FILE }}', workflow)
        self.assertIn('dotenv.parse(', workflow)
        self.assertIn('::add-mask::', workflow)
        self.assertIn('envs: JOZO_ENV_BASE64', workflow)
        self.assertIn('--env-file "$env_file"', workflow)
        self.assertLess(workflow.index('test -s "$env_file"'), workflow.index('docker stop jozo-be'))
        self.assertIn("trap 'rm -f \"$env_file\"' EXIT", workflow)

    def test_runtime_env_conversion(self):
        workflow = (ROOT / '.github/workflows/ci-cd.yml').read_text()
        section = workflow.split('      - name: Prepare runtime configuration\n', 1)[1]
        section = section.split('      - name: Get short SHA', 1)[0]
        script = textwrap.dedent(section.split('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'github_env'
            env = dict(os.environ, ENV_FILE_CONTENT='SAMPLE="value with spaces"\nTOKEN=\'value#x\'\n', GITHUB_ENV=str(output))
            result = subprocess.run(['bash', '-e', '-c', script], cwd=ROOT, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            encoded = output.read_text().strip().split('=', 1)[1]
            self.assertEqual(base64.b64decode(encoded).decode(), 'SAMPLE=value with spaces\nTOKEN=value#x\n')
            self.assertIn('::add-mask::' + encoded, result.stdout)
            env['ENV_FILE_CONTENT'] = 'MULTILINE="one\\ntwo"'
            result = subprocess.run(['bash', '-e', '-c', script], cwd=ROOT, env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
