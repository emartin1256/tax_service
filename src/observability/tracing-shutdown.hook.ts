import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { shutdownTracing } from './tracing';

@Injectable()
export class TracingShutdownHook implements BeforeApplicationShutdown {
  async beforeApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
