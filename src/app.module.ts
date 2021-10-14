import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FtpModule } from 'nestjs-ftp';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    FtpModule.forRootFtpAsync({
      useFactory: async () => {
        return {
          host: 'ftpupload.net',
          port: 21,
          user: 'epiz_30054819',
          password: 'TZtQdgeaM9xZk',
        };
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, ConfigService],
})
export class AppModule {}
