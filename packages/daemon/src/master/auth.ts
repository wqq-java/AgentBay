// Master API 用 Bearer token 鉴权。
//
// Token 自动生成在 ~/.agent-bay/master-token,Master Agent 启动时去读这个文件并放进
// Authorization header。
//
// 跟 worker MCP 完全分离的命名空间:worker 走 stdio MCP(没有 token);master 走 HTTP +
// Bearer。这是 AgentDeck 文章里的关键架构选择。

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDataDir } from '../config/paths.js';
import type { Request, Response, NextFunction } from 'express';

export function getMasterTokenPath(): string {
  return path.join(getDataDir(), 'master-token');
}

/**
 * 取或建 master token。
 * 如果文件不存在,自动生成 32 字节随机 token(base64,无填充)。
 */
export function ensureMasterToken(): string {
  const file = getMasterTokenPath();
  if (fs.existsSync(file)) {
    const t = fs.readFileSync(file, 'utf-8').trim();
    if (t.length >= 16) return t;
    // 文件存在但内容奇怪,重建
  }
  const token = randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

/**
 * Express middleware:校验 Authorization: Bearer <token>。
 * 不通过 → 401。
 */
export function masterAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.header('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing Bearer token' });
      return;
    }
    const provided = auth.slice('Bearer '.length).trim();
    if (provided !== token) {
      res.status(401).json({ error: 'invalid token' });
      return;
    }
    next();
  };
}
