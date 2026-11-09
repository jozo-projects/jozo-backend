# Management Socket.IO authentication

`SOCKET_MANAGEMENT_AUTH=true` enables management authentication; it is off when unset or any other value. To exercise locally, start the backend process with this environment variable set (without changing deployment configuration). Upgrade the admin frontend before enabling it on a shared server.

The admin sends its existing access token via Socket.IO `auth`, including on reconnect. When enabled, a valid access-token JWT must resolve to a current admin/staff database user to gain `management` and the actor's `user:<id>` room. No token leaves non-management clients connected but without these rooms; a supplied invalid token is rejected. Legacy query-based identities remain in effect when disabled.

This is management identity only, not device, room, table, printer, or event authorization. Existing device/print/order connections and event handlers remain legacy; their room or payload identifiers can still be spoofed and their event emissions are not authenticated. Do not treat this flag as protecting control/video, printer, table or other client actions. Existing JWTs are checked at connection/reconnection, not continuously revoked during a connected session.

Run the real Socket.IO websocket integration test with `npx jest src/sockets/managementAuth.test.ts --runInBand`.
