import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

const LANG_MAP = {
  javascript: 'javascript',
  python: 'python',
  cpp: 'cpp'
};

export default function EditorPage(){
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [name] = useState(()=> localStorage.getItem('cc_name') || `User${Math.floor(Math.random()*1000)}`);
  const editorRef = useRef(null);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const typingTimerRef = useRef(null);
  const [output, setOutput] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // connect socket and join
    const s = io(SOCKET_URL);
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('init', ({ code: initCode, language: initLang }) => {
      if (typeof initCode === 'string') setCode(initCode);
      if (initLang) setLanguage(initLang);
    });
    s.emit('joinRoom', { room: roomCode, name }, (res) => {
      if (res && res.error) {
        alert(res.error);
        navigate('/');
      }
    });
    s.on('roomUsers', ({ users }) => setUsers(users || []));
    s.on('userJoined', ({ name }) => pushSystem(`${name} joined`));
    s.on('userLeft', ({ name }) => pushSystem(`${name} left`));

    s.on('remoteCodeChange', ({ code: remoteCode, language: remoteLang, from }) => {
      // ignore if same socket (we only get remote because server uses socket.to)
      setCode(remoteCode);
      if (remoteLang) setLanguage(remoteLang);
    });

    s.on('typing', ({ name, isTyping }) => {
      setTypingUsers(prev => ({ ...prev, [name]: !!isTyping }));
      // remove after 3s if not typing
      if (isTyping) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(()=>{
          setTypingUsers(prev => { const cp = {...prev}; delete cp[name]; return cp; });
        }, 3000);
      }
    });

    s.on('runOutput', (payload) => {
      const text = payload.ok ? `STDOUT:\n${payload.stdout || ''}\nSTDERR:\n${payload.stderr || ''}` : `ERROR: ${payload.error || 'Unknown'}`;
      pushOutput(text);
    });

    return () => {
      if (s) {
        s.emit('leaveRoom');
        s.disconnect();
      }
    };
  }, [roomCode, name, navigate]);

  function pushSystem(msg){
    setOutput(prev => [...prev, { type: 'sys', text: msg }]);
  }
  function pushOutput(text){
    setOutput(prev => [...prev, { type:'output', text }]);
  }

  // propagate local code changes to server
  function handleEditorChange(value){
    setCode(value);
    if (!socket) return;
    socket.emit('codeChange', { room: roomCode, code: value, language });
    // typing indicator
    socket.emit('typing', { room: roomCode, name, isTyping: true });
    debounceStopTyping();
  }

  function debounceStopTyping(){
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket && socket.emit('typing', { room: roomCode, name, isTyping: false });
    }, 800);
  }

  function handleRun(){
    if (!socket) return;
    pushSystem('Running code...');
    socket.emit('runRequested', { room: roomCode, language, code }, (res) => {
      // the server broadcasts runOutput; this callback also gets a response
      if (res && res.error) pushOutput(`ERROR: ${res.error}`);
    });
  }

  function handleClearOutput(){
    setOutput([]);
  }
  function handleSave(){
    localStorage.setItem(`cc_code_${roomCode}_${language}`, code);
    pushSystem('Saved to localStorage');
  }
  function handleLogout(){
    if (socket) {
      socket.emit('leaveRoom');
      socket.disconnect();
    }
    localStorage.removeItem('cc_name');
    navigate('/');
  }

  function handleEditorMount(editor){
    editorRef.current = editor;
  }

  function loadSaved(){
    const key = `cc_code_${roomCode}_${language}`;
    const saved = localStorage.getItem(key);
    if (saved) setCode(saved);
  }

  useEffect(()=> {
    loadSaved();
    // eslint-disable-next-line
  }, [language]);

  return (
    <div className="editor-root">
      <aside className="sidebar">
        <div className="room-header">
          <h3>Room: {roomCode}</h3>
          <div className="status">{connected ? 'Connected' : 'Disconnected'}</div>
        </div>

        <div className="controls">
          <label>Language</label>
          <select value={language} onChange={e => {
            setLanguage(e.target.value);
            // notify server about language change by sending codeChange with language
            socket && socket.emit('codeChange', { room: roomCode, code, language: e.target.value });
          }}>
            <option value="javascript">JavaScript (Node)</option>
            <option value="python">Python 3</option>
            <option value="cpp">C++</option>
          </select>

          <button onClick={handleRun}>Run Code</button>
          <button onClick={handleClearOutput}>Clear Output</button>
          <button onClick={handleSave}>Save Code</button>
          <button onClick={handleLogout}>Logout</button>
        </div>

        <div className="users-list">
          <h4>Users</h4>
          <ul>
            {users.map((u, idx) => (
              <li key={idx}>
                {u.name} {u.name === name ? <em>(you)</em> : null}
                {typingUsers[u.name] ? <span className="typing-dot"> • typing</span> : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="room-info">
          <small>Share this code with collaborators to join</small>
        </div>
      </aside>

      <main className="main-area">
        <div className="editor-top">
          <div className="editor-meta">
            <strong>{language.toUpperCase()}</strong>
            <div className="live-indicator">{Object.values(typingUsers).some(Boolean) ? 'Someone typing...' : ''}</div>
          </div>
        </div>

        <div className="editor-container">
          <Editor
            height="60vh"
            defaultLanguage={LANG_MAP[language] || 'javascript'}
            language={LANG_MAP[language] || 'javascript'}
            value={code}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            options={{ fontSize: 14, minimap: { enabled: false } }}
          />
        </div>

        <div className="output-pane">
          <h4>Output</h4>
          <div className="output-content">
            {output.map((o, i) => (
              <pre key={i} className={o.type === 'sys' ? 'sys' : 'txt'}>{o.text}</pre>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
