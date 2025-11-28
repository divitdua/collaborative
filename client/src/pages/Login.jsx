import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:5000";

export default function Login() {
  const [mode, setMode] = useState("login"); // or register
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roomId, setRoomId] = useState("");
  const [msg, setMsg] = useState("");
  const navigate = useNavigate();

  async function doAuth(e) {
    e.preventDefault();
    setMsg("");
    const url = mode === "login" ? "/api/login" : "/api/register";
    try {
      const resp = await fetch(API + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const json = await resp.json();
      if (!resp.ok) { setMsg(json.error || "Auth failed"); return; }
      if (mode === "register") {
        setMsg("Registered. Please login.");
        setMode("login");
        return;
      }
      // login success
      localStorage.setItem("token", json.token);
      localStorage.setItem("username", json.username);
      // if room provided navigate to it, else ask user to enter:
      if (roomId.trim()) navigate(`/room/${roomId}`);
      else navigate(`/room/${Math.random().toString(36).slice(2,8)}`);
    } catch (e) {
      setMsg("Server error");
    }
  }

  return (
    <div className="join-container">
      <form className="join-form" onSubmit={doAuth}>
        <h2>{mode === "login" ? "Login" : "Register"}</h2>
        <input placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
        <input placeholder="Room ID (optional)" value={roomId} onChange={e=>setRoomId(e.target.value)} />
        <button type="submit">{mode === "login" ? "Login" : "Register"}</button>
        <p style={{color:"#ffdddd"}}>{msg}</p>
        <div style={{marginTop:12}}>
          <button type="button" onClick={()=>setMode(mode==="login"?"register":"login")}>
            {mode==="login" ? "Create account" : "Back to login"}
          </button>
        </div>
      </form>
    </div>
  );
}
