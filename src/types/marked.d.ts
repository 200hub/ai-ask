declare module 'marked' {
  export interface MarkedOptions {
    breaks?: boolean
    gfm?: boolean
  }

  export const marked: {
    parse: (markdown: string, options?: MarkedOptions) => string
    setOptions: (options: MarkedOptions) => void
  }
}
