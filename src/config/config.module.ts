import { DynamicModule, Global, Module } from '@nestjs/common';
import { type Env } from './env.schema';

export const ENV = Symbol('ENV');

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [
        {
          provide: ENV,
          useValue: env,
        },
      ],
      exports: [ENV],
    };
  }
}
