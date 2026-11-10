// The dictionaries, one file per part. A feature adds its own file here.
import * as shell from './shell';
import * as coreFormat from './coreFormat';
import * as coreSidebar from './coreSidebar';
import * as corePanes from './corePanes';
import * as coreJobs from './coreJobs';
import * as coreExt from './coreExt';
import * as coreMenu from './coreMenu';
import * as workspaces from './workspaces';
import * as keyboard from './keyboard';
import * as menuedit from './menuedit';
import * as appearance from './appearance';
import * as commands from './commands';
import * as finder from './finder';
import * as settings from './settings';
import * as explorer from './explorer';
import * as access from './access';
import * as search from './search';
import * as templates from './templates';
import * as openin from './openin';
import * as hash from './hash';
import * as columns from './columns';
import * as tags from './tags';
import * as share from './share';
import * as actions from './actions';
import * as disk from './disk';
import * as sync from './sync';
import * as git from './git';
import * as devices from './devices';
import * as phones from './phones';
import * as preview from './preview';
import * as rename from './rename';
import * as archive from './archive';
import * as stash from './stash';
import * as remote from './remote';
import * as office from './office';
import * as desktop from './desktop';

export const vi = {
  ...shell.vi,
  ...coreFormat.vi,
  ...coreSidebar.vi,
  ...corePanes.vi,
  ...coreJobs.vi,
  ...coreExt.vi,
  ...coreMenu.vi,
  ...workspaces.vi,
  ...keyboard.vi,
  ...menuedit.vi,
  ...appearance.vi,
  ...commands.vi,
  ...finder.vi,
  ...settings.vi,
  ...explorer.vi,
  ...access.vi,
  ...search.vi,
  ...templates.vi,
  ...openin.vi,
  ...hash.vi,
  ...columns.vi,
  ...tags.vi,
  ...share.vi,
  ...actions.vi,
  ...disk.vi,
  ...sync.vi,
  ...git.vi,
  ...devices.vi,
  ...phones.vi,
  ...preview.vi,
  ...rename.vi,
  ...archive.vi,
  ...stash.vi,
  ...remote.vi,
  ...office.vi,
  ...desktop.vi,
} as const;

export const en = {
  ...shell.en,
  ...coreFormat.en,
  ...coreSidebar.en,
  ...corePanes.en,
  ...coreJobs.en,
  ...coreExt.en,
  ...coreMenu.en,
  ...workspaces.en,
  ...keyboard.en,
  ...menuedit.en,
  ...appearance.en,
  ...commands.en,
  ...finder.en,
  ...settings.en,
  ...explorer.en,
  ...access.en,
  ...search.en,
  ...templates.en,
  ...openin.en,
  ...hash.en,
  ...columns.en,
  ...tags.en,
  ...share.en,
  ...actions.en,
  ...disk.en,
  ...sync.en,
  ...git.en,
  ...devices.en,
  ...phones.en,
  ...preview.en,
  ...rename.en,
  ...archive.en,
  ...stash.en,
  ...remote.en,
  ...office.en,
  ...desktop.en,
} as const;
