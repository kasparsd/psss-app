// The psss command's side of the socket: one request, one answer.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { VERSION, type Response } from './protocol.ts';

/** In the app this is a socket inside the app's group container. The prototype uses PSSS_SOCKET. */
export function socketPath(): string {
  return process.env.PSSS_SOCKET ?? path.join(os.tmpdir(), 'psss-prototype.sock');
}

export class NotRunning extends Error {}

export function ask(message: Record<string, unknown>, where = socketPath()): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(where);
    let buffer = '';
    let done = false;
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(JSON.stringify({ v: VERSION, ...message }) + '\n'));
    socket.on('data', (data) => {
      buffer += data;
      const cut = buffer.indexOf('\n');
      if (cut < 0 || done) return;
      done = true;
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, cut)));
      } catch (error) {
        reject(error);
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (done) return;
      done = true;
      reject(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? new NotRunning() : error);
    });
    socket.on('close', () => {
      if (!done) reject(new NotRunning());
    });
  });
}
