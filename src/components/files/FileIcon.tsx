import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
} from 'lucide-react';
import { IconTile } from '@/components/common/List';
import { fileCategory } from '@/utils/filename';

const ICONS = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
  code: FileCode,
  other: File,
};

export function FileIcon({ name, mime }: { name: string; mime: string }) {
  const Icon = ICONS[fileCategory(name, mime)];
  return <IconTile icon={<Icon />} />;
}
