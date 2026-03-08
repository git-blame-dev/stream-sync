import React from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '../shared/App'
import '../shared/styles.css'

const target = document.getElementById('app')

if (target) {
  const root = createRoot(target)
  root.render(<App mode="dock" />)
}
