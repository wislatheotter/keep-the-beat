import { DefaultLoadingManager } from 'three';
import { reportAssets } from '../entry';

DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  reportAssets(total > 0 ? loaded / total : 1);
};
