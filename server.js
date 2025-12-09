const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

const SECRET_KEY = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_AGE = 24 * 60 * 60 * 1000;

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
let db;

async function connectToMongoDB() {
  if (db) return db;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

app.use(async (req, res, next) => {
  try {
    if (!db) await connectToMongoDB();
    req.db = db;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

const verificarAutenticacao = (req, res, next) => {
  const token = req.cookies.auth_token;
  
  if (token) {
    try {
      const [usuario, timestamp, assinatura] = token.split('|');
      const expectedSignature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(`${usuario}|${timestamp}`)
        .digest('hex');
      
      if (assinatura === expectedSignature && Date.now() - parseInt(timestamp) < MAX_AGE) {
        req.usuario = usuario;
        return next();
      }
    } catch (error) {}
  }
  
  const caminhosPublicos = ['/api/auth/login', '/api/auth/status', '/api/teste'];
  const ehPublico = caminhosPublicos.some(caminho => req.path.startsWith(caminho));
  
  if (ehPublico) return next();
  res.status(401).json({ error: 'Não autenticado' });
};

app.use(verificarAutenticacao);

app.get('/api/teste', (req, res) => {
  res.json({ message: 'API funcionando no Vercel' });
});

app.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body;
  const USUARIO_CORRETO = process.env.ADMIN_USER || 'admin';
  const SENHA_CORRETA = process.env.ADMIN_PASSWORD || 'senha123';
  
  if (usuario === USUARIO_CORRETO && senha === SENHA_CORRETA) {
    const timestamp = Date.now();
    const data = `${usuario}|${timestamp}`;
    const assinatura = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
    const token = `${data}|${assinatura}`;
    
    res.cookie('auth_token', token, {
      maxAge: MAX_AGE,
      httpOnly: true,
      secure: true,
      sameSite: 'lax'
    });
    
    return res.json({ success: true, usuario });
  }
  
  res.status(401).json({ success: false, erro: 'Credenciais inválidas' });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ autenticado: !!req.usuario, usuario: req.usuario });
});

const regulacaoRoutes = require('../routes/regulacao.routes');
const auditoriaRoutes = require('../routes/auditoria.routes');
const faturamentoRoutes = require('../routes/faturamento.routes');

app.use('/api/regulacao', regulacaoRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/faturamento', faturamentoRoutes);

module.exports = app;
