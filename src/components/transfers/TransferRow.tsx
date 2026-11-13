import { ArrowDownToLine, ArrowUpFromLine, MessageSquareText } from 'lucide-react';
import { StatusLabel } from '@/components/common/Feedback';
import { IconTile, Row } from '@/components/common/List';
import type { TransferRecord } from '@/types';
import { formatBytes, formatRelativeTime } from '@/utils/format';
import { transferTitle } from '@/utils/transferTitle';

export function TransferRow({ record }: { record: TransferRecord }) {
  const sending = record.direction === 'send';
  const icon =
    record.kind === 'text' ? (
      <MessageSquareText />
    ) : sending ? (
      <ArrowUpFromLine />
    ) : (
      <ArrowDownToLine />
    );
  return (
    <Row
      to={`/activity/${record.id}`}
      leading={<IconTile icon={icon} />}
      title={transferTitle(record)}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>
            {sending ? 'To' : 'From'} {record.peerName}
            {record.kind === 'files' && ` · ${formatBytes(record.totalBytes)}`}
          </span>
          <StatusLabel status={record.status} />
        </span>
      }
      trailing={
        <span className="text-footnote tabular">{formatRelativeTime(record.startedAt)}</span>
      }
    />
  );
}
