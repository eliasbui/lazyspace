// Phones and cameras as places (src-tauri/src/features/phones.rs): a Devices section under the disks lists each one for as
// long as it is plugged in, those plugged in before the app started too, and a click opens it in the pane as device://,
// its folders and files as Image Capture reads them. A pane on a device lists again once the device has read its whole
// catalog, or is unlocked; one on a device that was unplugged goes home, as a tab on an ejected disk does.
import { t } from '@/i18n';
import { registry, type Crumb } from '@/lib/registry';
import { authorityOf, nameOf, pathOf, withPath } from '@/lib/uri';
import { api, on, type Uri } from '@/services';
import { PhonesSection } from './PhonesSection';
import { byKey, filesChanged, SCHEME, setPhones } from './store';

// A device's place is named after the device at its top, then by its folders.
const rootName = (uri: Uri): string => byKey(authorityOf(uri))?.name || t('ph.device');

export function register(): void {
  registry.places.name(SCHEME, (uri) => (pathOf(uri) === '/' ? rootName(uri) : nameOf(uri)));
  registry.places.crumbs(SCHEME, (uri) => {
    const items: Crumb[] = [[withPath(uri, '/'), rootName(uri), null]];
    let at = '';
    for (const part of pathOf(uri).split('/').filter(Boolean)) {
      at = `${at}/${part}`;
      items.push([withPath(uri, at), part, null]);
    }
    return items;
  });
  // Bookmarks are 10 and Locations 90: the devices come under the disks.
  registry.sidebar.section({ id: 'phones', title: null, order: 95, Component: PhonesSection });
  on('devices.phones', (list) => setPhones(Array.isArray(list) ? list : []));
  on('devices.files', (d) => filesChanged(d.key));
  on('app.hello', () => void api.devices.phones().then(setPhones, () => undefined));
}
