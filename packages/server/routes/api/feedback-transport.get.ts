import { defineEventHandler } from 'h3';
import { getRequestUser } from '../../utils/request-user';
import { requireAppAdmin } from '../../utils/access-control';
import { ok } from '../../utils/api-response';
import { getFeedbackTransportStatus } from '../../services/feedback-remote.service';
import { readFnOSMachineId } from '../../services/feedback-installation.service';
export default defineEventHandler(event=>{requireAppAdmin(getRequestUser(event));return ok({machineIdAvailable:Boolean(readFnOSMachineId()),lastRequest:getFeedbackTransportStatus()});});
