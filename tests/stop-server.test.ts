import { describe, expect, it } from 'vitest';
import { isCentralServer, listeningPidsFromNetstat, portFromEnvFile } from '../scripts/stop-server.ts';

describe('stop-server', () => {
  it('finds only the PIDs listening on the exact port in Windows netstat output', () => {
    const netstat = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    127.0.0.1:4000         0.0.0.0:0              LISTENING       16764',
      '  TCP    127.0.0.1:40001        0.0.0.0:0              LISTENING       222',
      '  TCP    127.0.0.1:4000         127.0.0.1:51234        ESTABLISHED     16764',
      '  TCP    [::1]:4000             [::]:0                 LISTENING       16764',
      '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       333',
    ].join('\r\n');
    expect(listeningPidsFromNetstat(netstat, 4000)).toEqual([16764]);
  });

  it('recognizes the Central server command line and nothing else', () => {
    const root = 'C:\\Users\\Mike\\Desktop\\Secretar_IA\\central-lia';
    const central =
      '"C:\\Program Files\\nodejs\\node.exe" --import file:///C:/Users/Mike/Desktop/Secretar_IA/central-lia/node_modules/tsx/dist/loader.mjs src/server/index.ts --demo';
    expect(isCentralServer(central, root)).toBe(true);
    expect(isCentralServer('"C:\\Program Files\\nodejs\\node.exe" other-app/server.js', root)).toBe(false);
    expect(isCentralServer('C:\\outro\\projeto\\node.exe src/server/index.ts', root)).toBe(false);
  });

  it('reads only PORT from the .env text, defaulting to 4000', () => {
    expect(portFromEnvFile('ANTHROPIC_API_KEY=x\nPORT=4100\n')).toBe(4100);
    expect(portFromEnvFile('# PORT=5000\nAPP_SECRET=y\n')).toBe(4000);
    expect(portFromEnvFile(null)).toBe(4000);
  });
});
