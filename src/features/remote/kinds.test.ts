import { describe, expect, it } from 'vitest';
import { described, emptyForm, kindOf, portOf, problems, remoteName, shownFields, webOf } from './kinds';

describe('the connection sheet', () => {
  it('shows the fields of each kind', () => {
    expect([...shownFields(emptyForm('sftp'))]).toEqual(expect.arrayContaining(['name', 'host', 'port', 'user', 'secret', 'keyFile', 'path']));
    expect(shownFields(emptyForm('s3')).has('host')).toBe(false);
    expect(shownFields(emptyForm('s3c')).has('endpoint')).toBe(true);
    expect(shownFields(emptyForm('nfs')).has('user')).toBe(false);
    expect(shownFields(emptyForm('smb')).has('guest')).toBe(true);
    const cloud = { ...emptyForm('rclone', 'sharepoint'), advanced: true };
    expect([...shownFields(cloud)].sort()).toEqual(['advanced', 'clientId', 'clientSecret', 'cloud', 'cloudName', 'site', 'tenant'].sort());
  });

  it('says what the host would refuse, as words', () => {
    expect(problems(emptyForm('sftp'), [])).toEqual({ host: 'needHost' });
    expect(problems({ ...emptyForm('sftp'), host: 'nas local', port: '70000' }, [])).toEqual({ host: 'badHost', port: 'badPort' });
    expect(problems({ ...emptyForm('s3c'), endpoint: 'minio.local' }, [])).toEqual({ endpoint: 'badEndpoint', user: 'needAccessKey' });
    expect(problems({ ...emptyForm('oss'), user: 'key' }, [])).toEqual({ region: 'needRegion' });
    expect(problems({ ...emptyForm('rclone'), cloudName: 'Drive' }, ['Drive'])).toEqual({ cloudName: 'cloudNameTaken' });
    expect(problems({ ...emptyForm('rclone'), cloudName: '-x' }, [])).toEqual({ cloudName: 'badCloudName' });
    expect(problems({ ...emptyForm('sftp'), host: 'nas.local', port: '22' }, [])).toEqual({});
  });

  it('describes the connection as remote.save takes it', () => {
    const c = described({ ...emptyForm('s3c'), endpoint: ' https://minio.local:9000 ', user: 'k', port: '9' }, 'ab');
    expect(c).toMatchObject({ id: 'ab', scheme: 's3', endpoint: 'https://minio.local:9000', port: 9 });
    expect(kindOf({ scheme: 's3', endpoint: 'https://x' })).toBe('s3c');
    expect(portOf('0')).toBeNull();
  });

  it('names a new remote after its cloud, numbered when taken', () => {
    expect(remoteName('drive', [])).toBe('GoogleDrive');
    expect(remoteName('drive', ['GoogleDrive', 'GoogleDrive2'])).toBe('GoogleDrive3');
  });

  it('finds the web page of a cloud', () => {
    expect(webOf('onedrive', 'OneDrive - Contoso', null)).toBe('https://www.microsoft365.com/onedrive');
    expect(webOf('onedrive', 'OneDrive - Personal', null)).toBe('https://onedrive.live.com/');
    expect(webOf('drive', 'Google Drive', 'me@example.com')).toContain('authuser=me%40example.com');
  });
});
