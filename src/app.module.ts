import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FtpModule } from 'nestjs-ftp';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    FtpModule.forRootFtpAsync({
      useFactory: async () => {
        return {
          host: '',
          port: 21,
          user: '',
          password: '',
          secure: false,
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
