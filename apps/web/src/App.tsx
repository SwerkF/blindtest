import { createBrowserRouter, RouterProvider } from "react-router-dom"
import Home from "@/pages/Home"
import Lobby from "@/pages/Lobby"
import Game from "@/pages/Game"
import Suggest from "@/pages/Suggest"

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/lobby/:code", element: <Lobby /> },
  { path: "/game/:code", element: <Game /> },
  { path: "/suggest", element: <Suggest /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
