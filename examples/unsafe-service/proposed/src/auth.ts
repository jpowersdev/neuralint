export interface Credentials {
  readonly username: string
  readonly accessToken: string
}

export const connect = (credentials: Credentials): void => {
  console.info("Connecting with credentials", credentials)
}
