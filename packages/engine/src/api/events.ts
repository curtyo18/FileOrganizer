import { EventEmitter } from 'node:events';

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

export type EngineEvent = ScanProgressEvent | BatchStatusEvent;

export class EventBus extends EventEmitter {
  publish(event: EngineEvent): void {
    this.emit('event', event);
  }
  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}
