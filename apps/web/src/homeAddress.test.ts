import { describe, expect, it } from 'vitest';
import { homeAddress } from './homeAddress';

describe('homeAddress', () => {
  it('knows the addresses of a home network from ones on the internet', () => {
    for (const a of ['http://192.168.1.20:7575', 'http://10.0.0.30:7575/', 'http://172.20.0.4:7575', 'http://localhost:7575', 'http://127.0.0.1:7575', 'http://nas:7575', 'http://nas.local:7575', 'http://[::1]:7575', 'http://100.101.2.3:7575'])
      expect([a, homeAddress(a)]).toEqual([a, true]);
    for (const a of ['https://squirrelcade.example.com', 'http://8.8.8.8:7575', 'http://172.32.0.1', 'https://games.example.org/squirrel']) expect([a, homeAddress(a)]).toEqual([a, false]);
  });
});
