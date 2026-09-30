import {Controller,Get,Post,Inject,Req,Body,Param} from '@nestjs/common';
import {Request} from 'express';
import {z} from 'zod';
import {AuthService} from './auth';
import {InventoryAdjustmentService} from './inventory-adjustments';
@Controller('api/v1/inventory')
export class InventoryController{
 constructor(@Inject(AuthService) private auth:AuthService,@Inject(InventoryAdjustmentService) private inventory:InventoryAdjustmentService){}
 @Get('adjustments') list(@Req() req:Request){return this.auth.context(req,'inventory:view').then(c=>this.inventory.list(c,req.query));}
 @Get('adjustments/:id') detail(@Req() req:Request,@Param('id') id:string){return this.auth.context(req,'inventory:view').then(c=>this.inventory.detail(c,id));}
 @Get('products') products(@Req() req:Request){return this.auth.context(req,'inventory:view').then(c=>this.inventory.productOptions(c,req.query));}
 @Get('warehouses') warehouses(@Req() req:Request){return this.auth.context(req,'inventory:view').then(c=>this.inventory.warehouseOptions(c,req.query));}
 @Get('balances') balances(@Req() req:Request){return this.auth.context(req,'inventory:view').then(c=>this.inventory.balances(c,req.query));}
 @Get('reconciliation') reconciliation(@Req() req:Request){return this.auth.context(req,'inventory:view').then(c=>this.inventory.reconciliation(c));}
 @Post('adjustments') create(@Req() req:Request,@Body() body:unknown){return this.auth.context(req,'inventory:create',true).then(c=>this.inventory.create(c,req.header('Idempotency-Key'),body));}
 @Post('adjustments/:id/reversal-drafts') async reverse(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.inventory.reverse(await this.auth.context(req,'inventory:reverse',true),req.header('Idempotency-Key'),id,body);}
 @Post('adjustments/:id/:action') async act(@Req() req:Request,@Param('id') id:string,@Param('action') raw:string,@Body() body:unknown){const action=z.enum(['submit','approve','reject','post','refresh','cancel']).parse(raw),permission={submit:'submit',approve:'approve',reject:'approve',post:'post',refresh:'submit',cancel:'cancel'}[action];return this.inventory.act(await this.auth.context(req,'inventory:'+permission,true),req.header('Idempotency-Key'),id,action,body);}
}
