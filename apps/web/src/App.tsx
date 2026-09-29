import { createBrowserRouter, RouterProvider } from "react-router-dom"
import Home from "@/pages/Home"
import Lobby from "@/pages/Lobby"
import Game from "@/pages/Game"
import Suggest from "@/pages/Suggest"
import Legal, { LegalDoc } from "@/pages/Legal"

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/join/:code", element: <Home /> },
  { path: "/lobby/:code", element: <Lobby /> },
  { path: "/game/:code", element: <Game /> },
  { path: "/suggest", element: <Suggest /> },
  { path: `/${LegalDoc.Notice}`, element: <Legal doc={LegalDoc.Notice} /> },
  { path: `/${LegalDoc.Terms}`, element: <Legal doc={LegalDoc.Terms} /> },
  { path: `/${LegalDoc.Privacy}`, element: <Legal doc={LegalDoc.Privacy} /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
