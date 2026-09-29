import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import App from "@/App"
import { applyPalette, getPalette } from "@/utils/palette"
import { prefersDark } from "@/components/ThemeToggle"
import "blobatar/motion.css"
import "@/index.css"

const queryClient = new QueryClient()
// Applied before the first render: pages without the toggle mounted still get the right look
applyPalette(getPalette())
document.documentElement.classList.toggle("dark", prefersDark())

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
