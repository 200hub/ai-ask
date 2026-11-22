import type { Component } from 'svelte'
import { HashRouter } from './hash-router.svelte'

export const desktopPages = import.meta.glob<{ default: Component }>('../pages/**/*.svelte')
export const desktopRouter = new HashRouter(Object.keys(desktopPages), '/')
