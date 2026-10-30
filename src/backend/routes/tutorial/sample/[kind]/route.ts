import { artifactContentType } from '@cjfclonedeep/capability-sdk/file';
import { generateFileBuffer } from '@cjfclonedeep/capability-sdk/file/node';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiError } from '@/server/http/api-request';

type RouteContext = { params: Promise<{ kind: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    requestApplicationUserId(request);
    const kind = (await context.params).kind;
    const fileName = kind === 'docx' ? 'Orbit-新手示例.docx' : kind === 'xlsx' ? 'Orbit-新手示例.xlsx' : '';
    if (!fileName) return new Response('Not found', { status: 404 });
    const generated = kind === 'docx'
      ? await generateFileBuffer({
          generator: 'html',
          program: '<!doctype html><html><head><meta charset="utf-8"><title>Orbit 文件演示</title></head><body><h1>Orbit 文件演示</h1><p>这是一个安全的示例文档。请让 Orbit 总结文档主题，并列出两条要点。</p></body></html>',
          documentType: 'word',
          fileName,
        })
      : await generateFileBuffer({
          generator: 'javascript',
          program: `export async function createDocument(job) {
            const workbook = new job.ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('任务数据');
            sheet.addRows([['项目', '状态', '负责人'], ['登录流程', '已完成', '测试用户'], ['导出验证', '待处理', '测试用户']]);
            await job.writeOutput(await workbook.xlsx.writeBuffer());
          }`,
          documentType: 'spreadsheet',
          fileName,
        });
    return new Response(new Uint8Array(generated.buffer), {
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Type': artifactContentType(fileName),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(request, error, { fallback: 'Unable to create tutorial sample' });
  }
}
