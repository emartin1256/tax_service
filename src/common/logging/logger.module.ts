import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { buildPinoHttpOptions } from './pino-http.config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: buildPinoHttpOptions(env),
      }),
    }),
  ],
})
export class AppLoggerModule {}
