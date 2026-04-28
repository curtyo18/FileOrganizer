import { EventEmitter } from 'node:events';
import type { ThrottleProfileName } from '@fileorganizer/shared';

export interface ScanProgressEvent {
  type: 'scan-progress';
  scanId: string;
  filesIndexed: number;
  filesUnchanged: number;
  filesSkipped: number;
  bytesProcessed: number;
}

export interface BatchStatusEvent {
  type: 'batch-status';
  batchId: string;
  status: string;
}

export interface ThrottleChangedEvent {
  type: 'throttle-changed';
  profile: ThrottleProfileName;
}

export type EngineEvent = ScanProgressEvent | BatchStatusEvent | ThrottleChangedEvent;

export class EventBus extends EventEmitter {
  publish(event: EngineEvent): void {
    this.emit('event', event);
  }
  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}
