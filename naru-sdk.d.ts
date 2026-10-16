// The Naru SDK the pages load at run time (app.ts, admin.ts). It publishes no
// types, so its client is untyped here.
declare module "https://naru.pub/sdk/1.1.0/naru.js" {
  export function createNaru(options?: { site?: string }): any;
}
