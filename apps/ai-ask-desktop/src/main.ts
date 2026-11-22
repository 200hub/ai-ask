import { mount, unmount } from 'svelte'
import App from './App.svelte'
import { desktopRouter } from './lib/navigation/router.svelte'
import './lib/styles/base.css'

const target = document.getElementById('app')
if (!target)
  throw new Error('Root element #app not found')

const stopRouting = desktopRouter.start()
const app = mount(App, { target })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopRouting()
    void unmount(app)
  })
}

export default app
