import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FtpService } from 'nestjs-ftp';
import { FileInfo, FTPResponse } from 'basic-ftp';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { InjectQueue, Process, Processor } from '@nestjs/bull';

import * as fs from 'fs';
import { Queue } from 'bull';
import { isAfter } from 'date-fns';

@Processor('downloadRemittances')
@Injectable()
export class AppService {
  constructor(
    private readonly ftpService: FtpService,
    @InjectQueue('uploadRemittances') private uploadEraQueue: Queue,
  ) {}

  @Process('downloadRemittances')
  async processRemittances() {
    /** get all clients */

    const clients = await this.getClients();
    const files = await this.getFormattedFiles();

    const groupedFiles = await this.groupBy(files, 'pcns');

    const batches = await this.createBatches(clients, groupedFiles);

    await this.getBatchFileContents(batches, clients);
  }

  getBatchFileContents = async (batches: any[], clients: any[]) => {
    const batchres = await Promise.all(
      clients.map(async (client) => {
        const filesToUpload: any[] = batches[client.pcns] || [];

        console.log(client, { structured: true });
        if (filesToUpload.length > 0) {
          //download the files
          const res = await Promise.all(
            filesToUpload.map(async (file) => {
              //wait for a few seconds
              const ftp = this.createFTPInstance();
              await new Promise((resolve) => setTimeout(resolve, 15000));

              return await this.downloadFile(
                `${file.name}`,
                `era/${file.name}`,
                ftp,
              );
            }),
          );

          console.log(res, { structured: true });

          //wait a few seconds
          //get File Content for each file

          const files = await Promise.all(
            filesToUpload.map(async (file) => {
              const content = await this.getFileContents(file);
              const splitContent = content.split('\n').map((line) => {
                const lineSplit = line.split(',');
                return lineSplit;
              });

              const headerRecord = splitContent.filter(
                (line) => line[0] === 'HDR',
              )[0];
              const footerRecord = splitContent.filter(
                (line) => line[0] === 'TRL',
              )[0];
              const lineRecords = splitContent.filter(
                (line) => line[0] === 'LIN',
              );

              const uploadedFile = {
                ...file,
                rawContent: content,
                stringifiedContent: JSON.stringify(splitContent),
                stringifiedLines: JSON.stringify(lineRecords),
                stringifiedHeader: JSON.stringify(headerRecord),
                stringifiedFooter: JSON.stringify(footerRecord),
                scheme: lineRecords[0][2],
                paymentDate: lineRecords[0][6],
                paymentMethod: lineRecords[0][5],
                dateReceived: file.modifiedAt,
                amountPaid: footerRecord[2].split('\r')[0],
                eraRef: headerRecord[5].split('\r')[0],
                paymentRef: headerRecord[3],
                tenantId: client.id,
                claimsIndex: client.claimsIndex,
              };

              return uploadedFile;
            }),
          );

          if (files?.length > 0) {
            this.uploadEraQueue.add('uploadRemittances', { eras: files });
          }
        }
      }),
    );

    return batchres[0];
  };

  /** YYYY-MM-DD to date */
  convertDate2(date: string) {
    const dateParts = date.split('-');
    if (dateParts.length !== 3) {
      return null;
    }

    if (dateParts.length === 3) {
      return new Date(+dateParts[0], +dateParts[1] - 1, +dateParts[2]);
    }
  }

  createFTPInstance() {
    const ftpInstance = new FtpService({
      host: 'ftp.switchafrica.co.za',
      port: 21,
      user: 'heartfelt',
      password: 'H34$tF#!t',
    });

    return ftpInstance;
  }

  async uploadToInstance(file) {
    const content = await this.getFileContents(file);

    const splitContent = content.split('\n').map((line) => {
      const lineSplit = line.split(',');
      return lineSplit;
    });

    const headerRecord = splitContent.filter((line) => line[0] === 'HDR')[0];
    const footerRecord = splitContent.filter((line) => line[0] === 'TRL')[0];
    const lineRecords = splitContent.filter((line) => line[0] === 'LIN');

    const uploadedFile = {
      ...file,
      rawContent: content,
      stringifiedContent: JSON.stringify(splitContent),
      stringifiedLines: JSON.stringify(lineRecords),
      stringifiedHeader: JSON.stringify(headerRecord),
      stringifiedFooter: JSON.stringify(footerRecord),
      scheme: lineRecords[0][2],
      paymentDate: headerRecord[6],
      paymentMethod: headerRecord[5],
      dateReceived: file.modifiedAt,
      amountPaid: footerRecord[2],
      eraRef: headerRecord[5],
    };

    console.info(uploadedFile, { structured: true });

    return uploadedFile;
  }

  async getFileContents(file: FileInfo) {
    const fileContents = await this.readFile(`${file.name}`);

    return fileContents;
  }

  //readFile from file system
  readFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(filePath);
      let fileContents = '';

      fileStream.on('data', (chunk) => {
        fileContents += chunk;
      });

      fileStream.on('error', (err) => {
        reject(err);
      });

      fileStream.on('end', () => {
        resolve(fileContents);
      });
    });
  }

  async createBatches(clients: any[], groupedFiles: any) {
    const batches = clients.map((client) => {
      const { lastEraUploaded } = client;
      const files: any[] = groupedFiles[client?.pcns] || [];

      if (files.length > 0) {
        console.log(`${client.pcns} files`, files, { structured: true });

        //remove files already uploaded
        const filesToUpload = files.filter((file) => {
          console.log(file.modifiedAt, lastEraUploaded, { structured: true });
          console.log(new Date(lastEraUploaded));
          console.log(
            isAfter(new Date(file.modifiedAt), new Date(lastEraUploaded)),

            {
              structured: true,
            },
          );
          return isAfter(new Date(file.modifiedAt), new Date(lastEraUploaded));

          // return where file modified date is greater than lastEraUploaded date
        });

        groupedFiles[client.pcns] = filesToUpload;

        console.info(
          `unsent batches for ${client.pcns} at ${new Date()}=>`,
          filesToUpload,
        );

        //remove undefined key value pairs from groupedFiles

        return groupedFiles;
      }
    });
    console.info(`unsent batches at ${new Date()}=>`, batches);

    //remove undefined array items
    const batchesToUpload = batches.filter((batch) => batch !== undefined);

    return batchesToUpload[0];
  }

  async groupBy(array: any[], key: string) {
    return array.reduce((result, currentValue) => {
      (result[currentValue[key]] = result[currentValue[key]] || []).push(
        currentValue,
      );
      return result;
    }, {});
  }

  async getFormattedFiles(): Promise<
    {
      name: string;
      size: number;
      rawModifiedAt: string;
      modifiedAt: Date;
      modifiedAtInMilliseconds: number;
    }[]
  > {
    const files: FileInfo[] = await this.listFiles();
    const formattedFiles = files.map((file) => {
      const { name, size, rawModifiedAt } = file;

      return {
        name,
        size,
        rawModifiedAt,
        modifiedAt: this.convertDate(rawModifiedAt),
        modifiedAtInMilliseconds: this.convertDate(rawModifiedAt).getTime(),
        pcns: name.split('-')[1],
      };
    });

    return formattedFiles;
  }

  //convert 'MMM dd HH:mm' to date using javascript
  convertDate(date: string): Date {
    const dateString = date.split(' ');
    const month = dateString[0];
    const day = dateString[1];
    const time = dateString[2];
    const dateTime = `${month} ${day} ${time} ${new Date()
      .getFullYear()
      .toString()}`;
    return new Date(dateTime);
  }

  async getClients() {
    const { data: clients, error } = await this.createSupabaseInstance()
      .from('tenants')
      .select('*');
    if (error) {
      throw new InternalServerErrorException(`Error: ${error.message}`);
    }

    return clients.map((client) => {
      const { lastEraDate: lastEraUploaded, lastEraSize, lastEraDate } = client;

      return {
        ...client,
        lastEraUploaded,
        lastEraUploadedMilliseconds: new Date(lastEraDate).getTime(),
        lastEraSize: parseInt(lastEraSize),
      };
    });
  }

  createSupabaseInstance(): SupabaseClient {
    const supabaseUrl = 'https://rmvsbkfhlnqgkssjfcwm.supabase.co';
    const supabaseKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjM5NjY1NDcxLCJleHAiOjE5NTUyNDE0NzF9.xuH4vkPrDjFYXUKbwilA2AVGM_htulx25vGPDxh0QPQ';
    const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

    return supabase;
  }

  async listFiles(): Promise<FileInfo[]> {
    try {
      const filesInfos = await this.ftpService.list('/era');
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
    instance?: FtpService,
  ): Promise<FTPResponse> {
    try {
      if (instance) {
        return await instance.downloadTo(localPath, remotePath);
      }
      return await this.ftpService.downloadTo(localPath, remotePath);
    } catch (error) {
      throw new InternalServerErrorException(`Error: ${error.message}`);
    }
  }
}
