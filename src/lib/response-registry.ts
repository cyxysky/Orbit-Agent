import { ResponseRegistry } from '@cjfclonedeep/capability-sdk';
import { coreResponses } from '@cjfclonedeep/capability-sdk/responses';
import { chartResponses } from '@cjfclonedeep/capability-sdk/chart/response';
import { mapResponses } from '@cjfclonedeep/capability-sdk/maps/response';

/** The application's installed output catalog. History uses this catalog, not active tools. */
export const responseRegistry = new ResponseRegistry()
  .register(coreResponses)
  .register(chartResponses)
  .register(mapResponses);
