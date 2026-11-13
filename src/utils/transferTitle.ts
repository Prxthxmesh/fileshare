import type { TransferRecord } from '@/types';
import { pluralize } from './format';

export function transferTitle(r: TransferRecord) {
  if (r.kind === 'text') {
    const first = r.textPreview?.split('\n')[0].slice(0, 60);
    return first ? `“${first}”` : `Text · ${pluralize(r.textLength ?? 0, 'character')}`;
  }
  return r.files.length === 1 ? r.files[0].name : pluralize(r.files.length, 'file');
}
