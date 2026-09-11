import { ResponseRegistry } from '@webpilot/capability-sdk';
import { coreResponses } from '@webpilot/capability-response';
import { chartResponses } from '@webpilot/capability-chart/response';
import { mapResponses } from '@webpilot/capability-maps/response';

/** The application's installed output catalog. History uses this catalog, not active tools. */
export const responseRegistry = new ResponseRegistry()
  .register(coreResponses)
  .register(chartResponses)
  .register(mapResponses);
