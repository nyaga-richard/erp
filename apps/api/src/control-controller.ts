import {ProductConfigurationService} from './product-configuration';
import {ProductReferencesService} from './product-references';
import {TaxConfigurationService} from './tax-configuration';
import {PostingRuleConfigurationService} from './posting-rule-configuration';
import {NumberingConfigurationService} from './numbering-configuration';
import {CoaService} from './coa';
import {OrganizationService} from './organization';
import {Controller,Get,Post,Body,Req,Param,Inject} from '@nestjs/common';
import {Request} from 'express';
import {AuthService} from './auth';
import {AdminService} from './admin';
import {WorkflowService} from './workflow';
import {SecurityService} from './security';
import {AccountingService} from './accounting';
@Controller('api/v1')
export class ControlController{
 constructor(@Inject(ProductConfigurationService) private products:ProductConfigurationService,@Inject(ProductReferencesService) private productRefs:ProductReferencesService,@Inject(TaxConfigurationService) private taxes:TaxConfigurationService,@Inject(PostingRuleConfigurationService) private rules:PostingRuleConfigurationService,@Inject(NumberingConfigurationService) private numbering:NumberingConfigurationService,@Inject(CoaService) private coa:CoaService,@Inject(OrganizationService) private organization:OrganizationService,@Inject(AuthService) private auth:AuthService,@Inject(AdminService) private admin:AdminService,@Inject(WorkflowService) private workflow:WorkflowService,@Inject(SecurityService) private security:SecurityService,@Inject(AccountingService) private accounting:AccountingService){}
 @Get('admin/products') async productCatalog(@Req() req:Request){return this.products.catalog(await this.auth.context(req,'products:view'),req.query);}
 @Get('admin/products/lookup') async productLookup(@Req() req:Request){return this.products.lookup(await this.auth.context(req,'products:view'),req.query);}
 @Get('admin/products/:id') async productDetail(@Req() req:Request,@Param('id') id:string){return this.products.detail(await this.auth.context(req,'products:view'),id);}
 @Get('admin/product-changes') async productChanges(@Req() req:Request){return this.products.changes(await this.auth.context(req,'products:view'),req.query);}
 @Post('admin/product-changes') async productPropose(@Req() req:Request,@Body() body:unknown){return this.products.propose(await this.auth.context(req,'products:propose',true),req.header('Idempotency-Key'),body);}
 @Post('admin/product-changes/:id/decide') async productDecide(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.products.decide(await this.auth.context(req,'products:approve',true),req.header('Idempotency-Key'),id,body);}
 @Post('admin/products/:id/tax-preview') async productTaxPreview(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.products.preview(await this.auth.context(req,'products:view',true),id,body);}
 @Get('admin/product-references') async productReferences(@Req() req:Request){return this.productRefs.list(await this.auth.context(req,'products:view'),req.query);}
 @Post('admin/product-references') async createProductReference(@Req() req:Request,@Body() body:unknown){return this.productRefs.create(await this.auth.context(req,'products:manage',true),req.header('Idempotency-Key'),body);}
 @Get('admin/tax-configuration') async taxCatalog(@Req() req:Request){return this.taxes.catalog(await this.auth.context(req,'taxes:view'),req.query);}
 @Get('admin/tax-accounts') async taxAccounts(@Req() req:Request){return this.taxes.accounts(await this.auth.context(req,'taxes:view'),req.query);}
 @Get('admin/tax-changes') async taxChanges(@Req() req:Request){return this.taxes.changes(await this.auth.context(req,'taxes:view'),req.query);}
 @Post('admin/tax-changes') async taxPropose(@Req() req:Request,@Body() body:unknown){return this.taxes.propose(await this.auth.context(req,'taxes:propose',true),req.header('Idempotency-Key'),body);}
 @Post('admin/tax-changes/:id/decide') async taxDecide(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.taxes.decide(await this.auth.context(req,'taxes:approve',true),req.header('Idempotency-Key'),id,body);}
 @Post('admin/tax-preview') async taxPreview(@Req() req:Request,@Body() body:unknown){return this.taxes.preview(await this.auth.context(req,'taxes:view',true),body);}
 @Get('admin/posting-rules/contracts') async postingContracts(@Req() req:Request){return this.rules.contracts(await this.auth.context(req,'rules:view'));}
 @Get('admin/posting-rules/accounts') async postingAccounts(@Req() req:Request){return this.rules.accounts(await this.auth.context(req,'rules:view'),req.query);}
 @Get('admin/posting-rules/scope-options') async postingScopes(@Req() req:Request){return this.rules.scopes(await this.auth.context(req,'rules:view'),req.query);}
 @Get('admin/posting-rules/effective') async postingEffective(@Req() req:Request){return this.rules.effective(await this.auth.context(req,'rules:view'),req.query);}
 @Get('admin/posting-rules') async postingCatalog(@Req() req:Request){return this.rules.catalog(await this.auth.context(req,'rules:view'),req.query);}
 @Get('admin/posting-rule-changes') async postingChanges(@Req() req:Request){return this.rules.changes(await this.auth.context(req,'rules:view'),req.query);}
 @Post('admin/posting-rule-changes') async postingPropose(@Req() req:Request,@Body() body:unknown){return this.rules.propose(await this.auth.context(req,'rules:propose',true),req.header('Idempotency-Key'),body);}
 @Post('admin/posting-rule-changes/:id/decide') async postingDecide(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.rules.decide(await this.auth.context(req,'rules:approve',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/numbering-policies') async numberingPolicies(@Req() req:Request){return this.numbering.catalog(await this.auth.context(req,'numbering:view'),req.query);}
 @Get('admin/numbering-policies/effective') async numberingEffective(@Req() req:Request){return this.numbering.effective(await this.auth.context(req,'numbering:view'),req.query);}
 @Get('admin/numbering-policies/types') async numberingTypes(@Req() req:Request){return this.numbering.types(await this.auth.context(req,'numbering:view'));}
 @Get('admin/numbering-policies/branches') async numberingBranches(@Req() req:Request){return this.organization.warehouseBranches(await this.auth.context(req,'numbering:view'),req.query);}
 @Get('admin/numbering-policy-changes') async numberingChanges(@Req() req:Request){return this.numbering.changes(await this.auth.context(req,'numbering:view'),req.query);}
 @Post('admin/numbering-policy-changes') async proposeNumbering(@Req() req:Request,@Body() body:unknown){return this.numbering.propose(await this.auth.context(req,'numbering:propose',true),req.header('Idempotency-Key'),body);}
 @Post('admin/numbering-policy-changes/:id/decide') async decideNumbering(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.numbering.decide(await this.auth.context(req,'numbering:approve',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/accounts') async accounts(@Req() req:Request){return this.coa.catalog(await this.auth.context(req,'accounts:configuration:view'),req.query);}
 @Get('admin/accounts/parents') async accountParents(@Req() req:Request){return this.coa.parents(await this.auth.context(req,'accounts:configuration:view'),req.query);}
 @Get('admin/account-changes') async accountChanges(@Req() req:Request){return this.coa.changes(await this.auth.context(req,'accounts:configuration:view'),req.query);}
 @Post('admin/account-changes') async proposeAccount(@Req() req:Request,@Body() body:unknown){return this.coa.propose(await this.auth.context(req,'accounts:propose',true),req.header('Idempotency-Key'),body);}
 @Post('admin/account-changes/:id/decide') async decideAccount(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.coa.decide(await this.auth.context(req,'accounts:approve',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/company') async company(@Req() req:Request){return this.organization.company(await this.auth.context(req,'organization:view'));}
 @Post('admin/company/revise') async companyName(@Req() req:Request,@Body() body:unknown){return this.organization.reviseCompany(await this.auth.context(req,'organization:profile:manage',true),req.header('Idempotency-Key'),body);}
 @Get('admin/warehouses/branch-options') async warehouseBranches(@Req() req:Request){return this.organization.warehouseBranches(await this.auth.context(req,'warehouses:view'),req.query);}
 @Get('admin/warehouses') async warehouses(@Req() req:Request){return this.organization.warehouses(await this.auth.context(req,'warehouses:view'),req.query);}
 @Post('admin/warehouses') async createWarehouse(@Req() req:Request,@Body() body:unknown){return this.organization.createWarehouse(await this.auth.context(req,'warehouses:manage',true),req.header('Idempotency-Key'),body);}
 @Post('admin/warehouses/:id/revise') async reviseWarehouse(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.organization.reviseWarehouse(await this.auth.context(req,'warehouses:manage',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/branches') async branches(@Req() req:Request){return this.organization.branches(await this.auth.context(req,'organization:view'),req.query);}
 @Post('admin/branches') async createBranch(@Req() req:Request,@Body() body:unknown){return this.organization.create(await this.auth.context(req,'organization:manage',true),req.header('Idempotency-Key'),body);}
 @Post('admin/branches/:id/revise') async reviseBranch(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.organization.revise(await this.auth.context(req,'organization:manage',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/users') async users(@Req() req:Request){return this.admin.listUsers(await this.auth.context(req,'users:view'),req.query);}
 @Post('admin/users') async createUser(@Req() req:Request,@Body() body:unknown){return this.admin.createUser(await this.auth.context(req,'users:manage',true),req.header('Idempotency-Key'),body);}
 @Post('admin/users/:id/access') async access(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.admin.changeAccess(await this.auth.context(req,'users:manage',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/roles') async roles(@Req() req:Request){return this.admin.roles(await this.auth.context(req,'roles:view'));}
 @Post('admin/roles') async createRole(@Req() req:Request,@Body() body:unknown){return this.admin.saveRole(await this.auth.context(req,'roles:manage',true),req.header('Idempotency-Key'),body);}
 @Post('admin/roles/:id/revise') async role(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.admin.saveRole(await this.auth.context(req,'roles:manage',true),req.header('Idempotency-Key'),body,id);}
 @Get('admin/permissions') async permissions(@Req() req:Request){return this.admin.permissions(await this.auth.context(req,'roles:view'));}
 @Get('admin/approval-policies') async policies(@Req() req:Request){return this.workflow.list(await this.auth.context(req,'approvals:view'));}
 @Post('admin/approval-policies') async draftPolicy(@Req() req:Request,@Body() body:unknown){return this.workflow.create(await this.auth.context(req,'approvals:manage',true),req.header('Idempotency-Key'),body);}
 @Post('admin/approval-policies/:id/publish') async publish(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.workflow.publish(await this.auth.context(req,'approvals:publish',true),req.header('Idempotency-Key'),id,body);}
 @Get('admin/security-events') async events(@Req() req:Request){return this.admin.security(await this.auth.context(req,'security:view'),req.query);}
 @Get('auth/sessions') sessions(@Req() req:Request){return this.security.sessions(req);}
 @Post('auth/sessions/:id/revoke') revoke(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.security.revoke(req,id,body);}
 @Post('auth/password-reset/request') reset(@Req() req:Request,@Body() body:unknown){return this.security.resetRequest(body,req);}
 @Post('auth/password-reset/consume') consume(@Req() req:Request,@Body() body:unknown){return this.security.consume(body,req);}
 @Post('auth/password/change') password(@Req() req:Request,@Body() body:unknown){return this.security.changePassword(body,req);}
 @Post('documents/:id/revise') async revise(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.accounting.revise(await this.auth.context(req,'journals:edit',true),req.header('Idempotency-Key'),id,body);}
 @Post('documents/:id/reject') async reject(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.accounting.rejectOrCancel(await this.auth.context(req,'journals:reject',true),req.header('Idempotency-Key'),id,'REJECT',body);}
 @Post('documents/:id/cancel') async cancel(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.accounting.rejectOrCancel(await this.auth.context(req,'journals:cancel',true),req.header('Idempotency-Key'),id,'CANCEL',body);}
}
