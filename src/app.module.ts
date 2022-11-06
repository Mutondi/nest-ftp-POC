import { HttpModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { FtpModule } from 'nestjs-ftp';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AlgoliaService } from './algolia/algolia.service';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot(),
    FtpModule.forRootFtpAsync({
      useFactory: async () => {
        return {
          host: 'ftp.switchafrica.co.za',
          port: 21,
          user: 'heartfelt',
          password: 'H34$tF#!t',
        };
      },
    }),
    BullModule.forRoot({
      redis: {
        host: 'brisk-rosewood-ccfa987166.redisgreen.net',
        port: 11042,
        password: '7vv349r8v24nwe7wkc7w5v4asbchv109',
        connectTimeout: 30000,
      },
    }),
    BullModule.registerQueue({
      name: 'downloadRemittances',
    }),
    BullModule.registerQueue({
      name: 'uploadRemittances',
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService, ConfigService, AlgoliaService],
})
export class AppModule {}
