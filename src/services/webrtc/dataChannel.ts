import { BUFFER_LOW_WATER } from '@/constants';

/** Both peers create the same pre-negotiated channel (id 0), so neither waits for `ondatachannel`. */
export function createNegotiatedChannel(pc: RTCPeerConnection): RTCDataChannel {
  const channel = pc.createDataChannel('fileshare', { negotiated: true, id: 0, ordered: true });
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
  return channel;
}

export class ChannelClosedError extends Error {
  constructor() {
    super('The connection closed.');
  }
}

/**
 * Resolves once channel.bufferedAmount has fallen to the low-water mark.
 * Rejects if the channel closes while waiting.
 */
export function waitForDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState !== 'open') return Promise.reject(new ChannelClosedError());
  if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      channel.removeEventListener('close', onClose);
      window.clearInterval(poll);
    };
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new ChannelClosedError());
    };
    // Safety net: some browser versions occasionally skip the event.
    const poll = window.setInterval(() => {
      if (channel.readyState !== 'open') onClose();
      else if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) onLow();
    }, 250);
    channel.addEventListener('bufferedamountlow', onLow);
    channel.addEventListener('close', onClose);
  });
}
