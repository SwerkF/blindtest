import { createBrowserRouter, RouterProvider } from "react-router-dom"
import Home from "@/pages/Home"
import Lobby from "@/pages/Lobby"
import Game from "@/pages/Game"
import Suggest from "@/pages/Suggest"
import Profile from "@/pages/Profile"
import UserProfile from "@/pages/UserProfile"
import Legal, { LegalDoc } from "@/pages/Legal"
import AccountRoot from "@/components/AccountRoot"

const router = createBrowserRouter([
  {
    // Account sync, per-user socket and toasts around every page
    element: <AccountRoot />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/join/:code", element: <Home /> },
      { path: "/lobby/:code", element: <Lobby /> },
      { path: "/game/:code", element: <Game /> },
      { path: "/suggest", element: <Suggest /> },
      { path: "/profil", element: <Profile /> },
      { path: "/u/:id", element: <UserProfile /> },
      { path: `/${LegalDoc.Notice}`, element: <Legal doc={LegalDoc.Notice} /> },
      { path: `/${LegalDoc.Terms}`, element: <Legal doc={LegalDoc.Terms} /> },
      { path: `/${LegalDoc.Privacy}`, element: <Legal doc={LegalDoc.Privacy} /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
