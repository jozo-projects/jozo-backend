export interface ICreateGameTypeRequestBody {
  name: string
  slug?: string
  description?: string
  image?: string
  isActive?: boolean
}

export interface IUpdateGameTypeRequestBody extends Partial<ICreateGameTypeRequestBody> {}

export interface ICreateGameRequestBody {
  typeId: string
  name: string
  slug?: string
  shortDescription?: string
  guideContent: string
  images?: string[]
  isActive?: boolean
}

export interface IUpdateGameRequestBody extends Partial<ICreateGameRequestBody> {}
