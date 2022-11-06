import { InjectQueue } from '@nestjs/bull';
import { Controller, Get } from '@nestjs/common';
import { AlgoliaService } from './algolia/algolia.service';
import { AppService } from './app.service';
import { Queue } from 'bull';
import { FtpService } from 'nestjs-ftp';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private ftp: FtpService,
    private algolia: AlgoliaService,
    @InjectQueue('downloadRemittances') private remittanceQueue: Queue,
    @InjectQueue('uploadRemittances') private uploadRemittance: Queue,
  ) {}

  @Get('htdocs')
  async getFiles(): Promise<any> {
    const job = await this.remittanceQueue.add('downloadRemittances', {
      txDate: new Date(),
    });

    console.info(job);
  }
  @Get('migratePatients')
  migratePatients(): any {
    return this.algolia.migratePatients();
  }

  @Get('missingClaims')
  missingClaims(): any {
    return this.algolia.getAllMissingClaims();
  }

  @Get('mahlogoClaims')
  mahlogoClaims(): any {
    return this.algolia.moveClaimsMahlogo();
  }
  @Get('movePatients')
  movePatients(): any {
    return this.algolia.movePatients();
  }

  @Get('moveSubjectives')
  async moveSubjectives(): Promise<any> {
    return await this.algolia.moveSubjectives();
  }

  @Get('moveAssessments')
  async moveAssessments(): Promise<any> {
    return await this.algolia.moveAssessments();
  }

  @Get('moveEncounters')
  async moveEncounters() {
    return await this.algolia.moveEncounters();
  }

  @Get('moveClaims')
  moveClaims(): any {
    return this.algolia.moveClaims();
  }

  @Get('moveCases')
  moveCases(): any {
    return this.algolia.moveCases();
  }

  @Get('movebatch')
  moveBatch(): any {
    return this.algolia.moveOneBatch();
  }

  //getFiles

  @Get('getFiles')
  async getAllFiles(): Promise<any> {
    return await this.ftp.list('era');
  }

  @Get('clearQueues')
  async clearQueues() {
    await this.remittanceQueue.clean(0, 'active');
    await this.remittanceQueue.clean(0, 'completed');
    await this.remittanceQueue.clean(0, 'failed');

    await this.uploadRemittance.clean(0, 'active');
    await this.uploadRemittance.clean(0, 'completed');
    await this.uploadRemittance.clean(0, 'failed');
  }
}
