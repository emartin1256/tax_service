import { parseEnv } from './config/env.schema';
import { initializeTracing } from './observability/tracing';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  await initializeTracing(env.OTEL_ENABLED);

  const { ValidationPipe } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { Logger } = await import('nestjs-pino');
  const { ApiExceptionFilter } =
    await import('./common/filters/api-exception.filter');
  const { AppModule } = await import('./app.module');
  const { setupSwagger } = await import('./swagger/setup-swagger');

  const app = await NestFactory.create(AppModule.register(env), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: false,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  setupSwagger(app);
  app.enableShutdownHooks();

  await app.listen(env.PORT);
}

void bootstrap();
