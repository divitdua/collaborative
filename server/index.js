// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;

// In-memory rooms state
// rooms[roomCode] = { users: { socketId: { name } }, code: string, language: 'javascript' }
const rooms = {};

function makeTempFile(ext, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-'));
  const filename = path.join(dir, `code${ext}`);
  fs.writeFileSync(filename, content);
  return { dir, filename };
}
function cleanupTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch(e) { /* ignore */ }
}

function runJS(code, cb) {
  try {
    const { dir, filename } = makeTempFile('.js', code);
    const proc = spawn('node', [filename], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const killTimer = setTimeout(()=>proc.kill('SIGKILL'), 5000);
    proc.stdout.on('data', d => { out += d.toString(); if (out.length>20000) proc.kill('SIGKILL'); });
    proc.stderr.on('data', d => { err += d.toString(); if (err.length>20000) proc.kill('SIGKILL'); });
    proc.on('close', codeExit => {
      clearTimeout(killTimer);
      cleanupTempDir(dir);
      cb(null, { stdout: out, stderr: err, exitCode: codeExit });
    });
  } catch(e){ cb(e); }
}

function runPython(code, cb) {
  try {
    const { dir, filename } = makeTempFile('.py', code);

    // Detect correct Python command
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const proc = spawn(pythonCmd, [filename], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), 5000);

    proc.stdout.on('data', d => {
      out += d.toString();
      if (out.length > 20000) proc.kill('SIGKILL');
    });

    proc.stderr.on('data', d => {
      err += d.toString();
      if (err.length > 20000) proc.kill('SIGKILL');
    });

    proc.on('close', codeExit => {
      clearTimeout(killTimer);
      cleanupTempDir(dir);
      cb(null, { stdout: out, stderr: err, exitCode: codeExit });
    });

  } catch (e) {
    cb(e);
  }
}


function runCpp(code, cb) {
  try {
    const { dir, filename } = makeTempFile('.cpp', code);

    // Detect output executable name
    const exeName = process.platform === 'win32' ? 'a.exe' : 'a.out';
    const exePath = path.join(dir, exeName);

    // Detect g++ command (Windows often needs g++.exe)
    const gppCmd = process.platform === 'win32' ? 'g++' : 'g++';

    const compile = spawn(gppCmd, [filename, '-O2', '-std=c++17', '-o', exePath]);
    let compileErr = '';

    const compileTimer = setTimeout(() => compile.kill('SIGKILL'), 10000);

    compile.stderr.on('data', d => {
      compileErr += d.toString();
      if (compileErr.length > 20000) compile.kill('SIGKILL');
    });

    compile.on('close', compileCode => {
      clearTimeout(compileTimer);

      if (compileCode !== 0) {
        cleanupTempDir(dir);
        return cb(null, {
          stdout: '',
          stderr: compileErr,
          exitCode: compileCode
        });
      }

      // Run compiled program
      const proc = spawn(exePath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: dir
      });

      let out = '', err = '';
      const runTimer = setTimeout(() => proc.kill('SIGKILL'), 5000);

      proc.stdout.on('data', d => {
        out += d.toString();
        if (out.length > 20000) proc.kill('SIGKILL');
      });

      proc.stderr.on('data', d => {
        err += d.toString();
        if (err.length > 20000) proc.kill('SIGKILL');
      });

      proc.on('close', rc => {
        clearTimeout(runTimer);
        cleanupTempDir(dir);
        cb(null, {
          stdout: out,
          stderr: err,
          exitCode: rc
        });
      });
    });

  } catch (e) {
    cb(e);
  }
}


// HTTP endpoint for running code (optional - socket also supports)
app.post('/api/run', (req, res) => {
  const { language, code, room } = req.body || {};
  if (!language || typeof code !== 'string') return res.status(400).json({ error: 'language and code required' });
  const start = Date.now();
  const finish = (err, result) => {
    if (err) return res.json({ ok:false, error:String(err), stdout:'', stderr:'', time: Date.now()-start });
    const payload = { ok:true, stdout: result.stdout||'', stderr: result.stderr||'', exitCode: result.exitCode, time: Date.now()-start };
    if (room) io.to(room).emit('runOutput', payload);
    return res.json(payload);
  };
  if (language === 'javascript') return runJS(code, finish);
  if (language === 'python') return runPython(code, finish);
  if (language === 'cpp') return runCpp(code, finish);
  return res.status(400).json({ error: 'unsupported language' });
});

// Socket.io events
io.on('connection', socket => {
  console.log('connected', socket.id);

  socket.on('createRoom', ({ name }, cb) => {
    const roomCode = uuidv4().slice(0,8);
    rooms[roomCode] = { users: {}, code: getDefaultTemplate('javascript'), language: 'javascript' };
    socket.join(roomCode);
    rooms[roomCode].users[socket.id] = { name };
    socket.data.name = name;
    socket.data.room = roomCode;
    // ack with room code
    cb && cb({ room: roomCode });
    io.to(roomCode).emit('roomUsers', { users: Object.values(rooms[roomCode].users) });
    io.to(roomCode).emit('userJoined', { name });
  });

  socket.on('joinRoom', ({ room, name }, cb) => {
    const r = rooms[room];
    if (!r) return cb && cb({ error: 'Room not found' });
    socket.join(room);
    r.users[socket.id] = { name };
    socket.data.name = name;
    socket.data.room = room;
    // send current code & language
    socket.emit('init', { code: r.code || '', language: r.language || 'javascript' });
    io.to(room).emit('roomUsers', { users: Object.values(r.users) });
    io.to(room).emit('userJoined', { name });
    cb && cb({ ok: true });
  });

  socket.on('leaveRoom', () => {
    const room = socket.data.room;
    const name = socket.data.name;
    if (room && rooms[room]) {
      delete rooms[room].users[socket.id];
      socket.leave(room);
      io.to(room).emit('roomUsers', { users: Object.values(rooms[room].users) });
      io.to(room).emit('userLeft', { name });
    }
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    const name = socket.data.name;
    if (room && rooms[room]) {
      delete rooms[room].users[socket.id];
      io.to(room).emit('roomUsers', { users: Object.values(rooms[room].users) });
      io.to(room).emit('userLeft', { name });
    }
    console.log('disconnect', socket.id);
  });

  // collaborative code changes
  socket.on('codeChange', ({ room, code, language }) => {
    if (!room) return;
    if (!rooms[room]) rooms[room] = { users: {}, code: code || '', language: language || 'javascript' };
    rooms[room].code = code;
    if (language) rooms[room].language = language;
    socket.to(room).emit('remoteCodeChange', { code, language, from: socket.id });
  });

  socket.on('typing', ({ room, name, isTyping }) => {
    if (!room) return;
    socket.to(room).emit('typing', { name, isTyping });
  });

  socket.on('runRequested', ({ room, language, code }, cb) => {
    if (!language || typeof code !== 'string') return cb && cb({ error: 'language and code required' });
    const runCb = (err, result) => {
      if (err) {
        const payload = { ok:false, error:String(err), stdout:'', stderr:'', exitCode:null };
        io.to(room).emit('runOutput', payload);
        return cb && cb(payload);
      }
      const payload = { ok:true, stdout: result.stdout||'', stderr: result.stderr||'', exitCode: result.exitCode };
      io.to(room).emit('runOutput', payload);
      return cb && cb(payload);
    };
    if (language === 'javascript') return runJS(code, runCb);
    if (language === 'python') return runPython(code, runCb);
    if (language === 'cpp') return runCpp(code, runCb);
    return cb && cb({ error: 'unsupported language' });
  });
});

function getDefaultTemplate(lang) {
  if (lang === 'python') return 'print(\"Hello from Python\")\n';
  if (lang === 'cpp') return '#include <iostream>\nusing namespace std;\nint main(){ cout<<\"Hello from C++\"<<\"\\n\"; return 0; }\n';
  return 'console.log(\"Hello from JavaScript\");\n';
}

server.listen(PORT, () => console.log('Server listening on', PORT));
