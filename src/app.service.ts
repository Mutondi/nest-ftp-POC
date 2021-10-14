import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FtpService } from 'nestjs-ftp';
import { FileInfo, FTPResponse } from 'basic-ftp';

@Injectable()
export class AppService {
  constructor(private readonly ftpService: FtpService) {}

  async listFiles(): Promise<FileInfo[]> {
    try {
      const filesInfos = await this.ftpService.list();
      return filesInfos;
    } catch (error) {
      throw new InternalServerErrorException(`Error: ${error.message}`);
    }
  }

  async uploadFile(fileName: string, remotePath: string): Promise<FTPResponse> {
    try {
      return await this.ftpService.upload(fileName, remotePath);
    } catch (error) {
      throw new InternalServerErrorException(`Error: ${error.message}`);
    }
  }

  async downloadFile(
    localPath: string,
    remotePath: string,
  ): Promise<FTPResponse> {
    try {
      return await this.ftpService.downloadTo(localPath, remotePath);
    } catch (error) {
      throw new InternalServerErrorException(`Error: ${error.message}`);
    }
  }
}
