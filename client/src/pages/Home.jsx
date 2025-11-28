import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function Home(){
  const [name, setName] = useState(localStorage.getItem('cc_name') || '');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function createRoom(){
    if (!name.trim()) return alert('Enter your name');
    setLoading(true);
    const socket = io(SOCKET_URL, { autoConnect: false });
    socket.connect();
    socket.emit('createRoom', { name }, ({ room } = {}) => {
      socket.disconnect();
      setLoading(false);
      if (room) {
        localStorage.setItem('cc_name', name);
        navigate(`/room/${room}`);
      } else {
        alert('Failed to create room');
      }
    });
    socket.on('connect_error', (err) => {
      console.error(err);
      setLoading(false);
      socket.disconnect();
      alert('Socket connect error');
    });
  }

  async function joinRoom(){
    if (!name.trim()) return alert('Enter your name');
    if (!joinCode.trim()) return alert('Enter a room code');
    setLoading(true);
    const socket = io(SOCKET_URL, { autoConnect: false });
    socket.connect();
    socket.emit('joinRoom', { room: joinCode.trim(), name }, (res) => {
      socket.disconnect();
      setLoading(false);
      if (res && res.error) {
        alert(res.error);
      } else {
        localStorage.setItem('cc_name', name);
        navigate(`/room/${joinCode.trim()}`);
      }
    });
    socket.on('connect_error', () => {
      setLoading(false);
      socket.disconnect();
      alert('Socket connect error');
    });
  }

  return (
    <div className="home-root">
      <div className="card">
        <h1>Collaborative Code Editor</h1>
        <label>Name</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" />
        <div className="row">
          <button onClick={createRoom} disabled={loading}>Create Room</button>
          <div className="or">OR</div>
          <input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Room code" />
          <button onClick={joinRoom} disabled={loading}>Join Room</button>
        </div>
        <p className="hint">Create a room to get a unique room code (8 chars). Share it with collaborators.</p>
      </div>
    </div>
  );
}
