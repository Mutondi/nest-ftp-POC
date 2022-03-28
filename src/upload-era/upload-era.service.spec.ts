import { Test, TestingModule } from '@nestjs/testing';
import { UploadEraService } from './upload-era.service';

describe('UploadEraService', () => {
  let service: UploadEraService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UploadEraService],
    }).compile();

    service = module.get<UploadEraService>(UploadEraService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
