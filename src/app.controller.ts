import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { FileInfo, FTPResponse } from 'basic-ftp';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  @Get('htdocs')
  getFiles(): Promise<FileInfo[]> {
    return this.appService.listFiles();
  }

  @Get('catalog')
  downloadFile(@Query() query): Promise<FTPResponse> {
    const { localPath, remotePath } = query;
    return this.appService.downloadFile(localPath, remotePath);
  }

  @Post('catalog')
  uploadFile(
    @Body() /* body  */
    { filePath, remotePath }: { filePath: string; remotePath: string },
  ): Promise<FTPResponse> {
    //const { filePath, remotePath } = body;
    return this.appService.uploadFile(filePath, remotePath);
  }
}
