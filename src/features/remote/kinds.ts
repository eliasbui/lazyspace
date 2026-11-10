// The kinds of connection the sheet offers, the clouds rclone signs in to, and the checks of the form, as data and pure
// functions (kinds.test.ts checks them).
import type { WordKey } from '@/i18n';
import type { CloudKind, Connection, ConnectionScheme } from '@/services';

/** A kind of the sheet: "s3c" is S3 at an address of its own, "rclone" a cloud signed in to through rclone. */
export type ServerKind = 'sftp' | 'ftp' | 'ftps' | 's3' | 's3c' | 'oss' | 'smb' | 'afp' | 'nfs' | 'davs' | 'dav' | 'rclone';

export const KINDS: ReadonlyArray<[kind: ServerKind, label: WordKey]> = [
  ['sftp', 'kindSftp'],
  ['ftp', 'kindFtp'],
  ['ftps', 'kindFtps'],
  ['s3', 'kindS3'],
  ['s3c', 's3Compatible'],
  ['oss', 'kindOss'],
  ['smb', 'kindSmb'],
  ['afp', 'kindAfp'],
  ['nfs', 'kindNfs'],
  ['davs', 'kindDavs'],
  ['dav', 'kindDav'],
  ['rclone', 'cloudRclone'],
];

/** The places on servers the app opens itself (a mounted share is a folder of this Mac). */
export const SERVER_SCHEMES = ['sftp', 'ftp', 'ftps', 's3', 'oss'];
export const PASSWORD = 'LZ-PASSWORD:';
export const TRUST = 'LZ-HOSTKEY:';

export const PORTS: Partial<Record<ServerKind, number>> = { sftp: 22, ftp: 21, ftps: 21, smb: 445, afp: 548, nfs: 2049, dav: 80, davs: 443 };

export const CLOUDS: Record<CloudKind, WordKey> = {
  drive: 'cloudDrive',
  dropbox: 'cloudDropbox',
  onedrive: 'cloudOnedrive',
  onedrive_work: 'onedriveWork',
  sharepoint: 'cloudSharepoint',
  box: 'cloudBox',
  pcloud: 'cloudPcloud',
  mega: 'cloudMega',
  yandex: 'cloudYandex',
  koofr: 'cloudKoofr',
  jottacloud: 'cloudJottacloud',
  sharefile: 'cloudSharefile',
};

export const isCloudKind = (kind: string): kind is CloudKind => kind in CLOUDS;

/** The name a sign in gives a remote when none is typed: "GoogleDrive", then "GoogleDrive2". */
const BASES: Record<CloudKind, string> = {
  drive: 'GoogleDrive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  onedrive_work: 'OneDriveWork',
  sharepoint: 'SharePoint',
  box: 'Box',
  pcloud: 'pCloud',
  mega: 'MEGA',
  yandex: 'YandexDisk',
  koofr: 'Koofr',
  jottacloud: 'Jottacloud',
  sharefile: 'ShareFile',
};

export function remoteName(kind: CloudKind, taken: readonly string[]): string {
  const base = BASES[kind];
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}${i}`;
  return name;
}

/** The clouds whose own app ids take a tenant. */
export const MICROSOFT: readonly CloudKind[] = ['onedrive', 'onedrive_work', 'sharepoint'];

/** The service a remote of rclone is shown as in the sidebar: a work OneDrive and SharePoint are both "OneDrive"'s kin. */
export function serviceWord(kind: string): WordKey | null {
  if (kind === 'onedrive_work') return 'cloudOnedrive';
  if (kind === 'sharepoint') return 'cloudSharepoint';
  return isCloudKind(kind) ? CLOUDS[kind] : null;
}

export const schemeOfKind = (kind: Exclude<ServerKind, 'rclone'>): ConnectionScheme => (kind === 's3c' ? 's3' : kind);
export const kindOf = (c: Pick<Connection, 'scheme' | 'endpoint'>): ServerKind => (c.scheme === 's3' && c.endpoint ? 's3c' : c.scheme);
export const isS3 = (kind: ServerKind): boolean => kind === 's3' || kind === 's3c' || kind === 'oss';
export const isMounted = (kind: ServerKind): boolean => kind === 'smb' || kind === 'afp' || kind === 'nfs' || kind === 'dav' || kind === 'davs';

/** The web page of a cloud, to see there what its folder on this Mac does not hold (what was shared, the web's Recent). */
export function webOf(service: string | null | undefined, name: string, account: string | null | undefined): string {
  const office = 'https://www.microsoft365.com/onedrive';
  if (service === 'onedrive_work' || service === 'sharepoint') return office;
  // The app's folders are "OneDrive - Personal" and "OneDrive - <organisation>"; rclone's personal one is "OneDrive".
  if (service === 'onedrive') return / - /.test(name) && !/personal/i.test(name) ? office : 'https://onedrive.live.com/';
  if (service === 'drive') return account?.includes('@') ? `https://drive.google.com/drive/my-drive?authuser=${encodeURIComponent(account)}` : 'https://drive.google.com/';
  if (service === 'dropbox') return 'https://www.dropbox.com/home';
  if (service === 'box') return 'https://app.box.com/';
  if (service === 'icloud') return 'https://www.icloud.com/iclouddrive/';
  return '';
}

/** What the form holds; every text as typed. */
export interface ServerForm {
  kind: ServerKind;
  name: string;
  host: string;
  port: string;
  endpoint: string;
  region: string;
  user: string;
  secret: string;
  keyFile: string;
  path: string;
  bucket: string;
  guest: boolean;
  cloud: CloudKind;
  cloudName: string;
  site: string;
  advanced: boolean;
  clientId: string;
  clientSecret: string;
  tenant: string;
}

export type FieldName = Exclude<keyof ServerForm, 'kind' | 'guest' | 'advanced' | 'cloud'> | 'cloud' | 'guest' | 'advanced';

/** The fields the kind uses. */
export function shownFields(form: Pick<ServerForm, 'kind' | 'cloud' | 'advanced'>): Set<FieldName> {
  const { kind, cloud } = form;
  const rclone = kind === 'rclone';
  const s3 = isS3(kind);
  const advanced = rclone && form.advanced;
  const shown: Record<FieldName, boolean> = {
    name: !rclone,
    host: !s3 && !rclone,
    port: !s3 && !rclone,
    endpoint: kind === 's3c',
    region: s3,
    user: !rclone && kind !== 'nfs',
    secret: !rclone && kind !== 'nfs',
    keyFile: kind === 'sftp',
    path: !rclone && !s3,
    bucket: s3,
    guest: kind === 'smb' || kind === 'afp',
    cloud: rclone,
    cloudName: rclone,
    site: rclone && cloud === 'sharepoint',
    advanced: rclone,
    clientId: advanced,
    clientSecret: advanced,
    tenant: advanced && MICROSOFT.includes(cloud),
  };
  return new Set((Object.keys(shown) as FieldName[]).filter((f) => shown[f]));
}

const hostOk = (h: string): boolean => h.length > 0 && h.length <= 253 && /^[A-Za-z0-9._:[\]%-]+$/.test(h);

/** The port as remote.save takes it: a number from 1 to 65535, or null when empty or out of range. */
export function portOf(text: string): number | null {
  const port = Number(text.trim());
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/** What is wrong with the form, field by field, as the host would refuse it; only the fields the kind shows. */
export function problems(form: ServerForm, remotes: readonly string[]): Partial<Record<FieldName, WordKey>> {
  const shown = shownFields(form);
  const out: Partial<Record<FieldName, WordKey>> = {};
  const host = form.host.trim();
  if (shown.has('host')) {
    if (!host) out.host = 'needHost';
    else if (!hostOk(host)) out.host = 'badHost';
  }
  if (shown.has('port') && form.port.trim() && portOf(form.port) === null) out.port = 'badPort';
  if (shown.has('endpoint')) {
    const endpoint = form.endpoint.trim();
    const rest = endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!endpoint) out.endpoint = 'needEndpoint';
    else if (!/^https?:\/\//.test(endpoint) || !hostOk(rest)) out.endpoint = 'badEndpoint';
  }
  if (shown.has('region')) {
    const region = form.region.trim();
    if (form.kind === 'oss' && !region) out.region = 'needRegion';
    else if (!/^[a-z0-9-]*$/.test(region)) out.region = 'badRegion';
  }
  if (shown.has('bucket') && !/^[a-z0-9._-]*$/.test(form.bucket.trim())) out.bucket = 'badBucket';
  if (isS3(form.kind) && !form.user.trim()) out.user = 'needAccessKey';
  if (shown.has('cloudName')) {
    const name = form.cloudName.trim();
    if (name && !(name.length <= 64 && /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(name))) out.cloudName = 'badCloudName';
    else if (name && remotes.includes(name)) out.cloudName = 'cloudNameTaken';
  }
  if (shown.has('tenant') && !/^[A-Za-z0-9.-]*$/.test(form.tenant.trim())) out.tenant = 'badTenant';
  return out;
}

/** The connection the form describes, as remote.save and remote.test take it. */
export function described(form: ServerForm, id: string): Partial<Connection> {
  if (form.kind === 'rclone') throw new Error('A cloud of rclone is signed in to, not saved');
  return {
    id,
    scheme: schemeOfKind(form.kind),
    port: portOf(form.port),
    guest: form.guest,
    name: form.name.trim(),
    host: form.host.trim(),
    region: form.region.trim(),
    user: form.user.trim(),
    keyFile: form.keyFile.trim(),
    path: form.path.trim(),
    bucket: form.bucket.trim(),
    endpoint: form.kind === 's3c' ? form.endpoint.trim() : '',
  };
}

export function emptyForm(kind: ServerKind = 'sftp', cloud: CloudKind = 'drive'): ServerForm {
  return { kind, name: '', host: '', port: '', endpoint: '', region: '', user: '', secret: '', keyFile: '', path: '', bucket: '', guest: false, cloud, cloudName: '', site: '', advanced: false, clientId: '', clientSecret: '', tenant: '' };
}

export function formOf(conn: Connection): ServerForm {
  return { ...emptyForm(kindOf(conn)), name: conn.name, host: conn.host, port: conn.port ? String(conn.port) : '', endpoint: conn.endpoint, region: conn.region, user: conn.user, keyFile: conn.keyFile, path: conn.path, bucket: conn.bucket, guest: conn.guest };
}
