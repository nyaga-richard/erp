-- Target domain baseline. Structure is not proof of implemented workflows.
BEGIN;

CREATE TABLE pos_terminals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
 branch_id uuid NOT NULL,
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 UNIQUE(company_id,code)
);

CREATE TABLE cashier_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 cashier_id uuid NOT NULL REFERENCES users(id), status text NOT NULL CHECK(status IN ('OPEN','ACTIVE','RECONCILIATION','CLOSED')), opened_at timestamptz NOT NULL, closed_at timestamptz, reconciled_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id), expected_cash money_amount, actual_cash money_amount, variance_reason text,
 terminal_id uuid NOT NULL,
 FOREIGN KEY(company_id,terminal_id) REFERENCES pos_terminals(company_id,id),
 branch_id uuid NOT NULL,
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id)
);

CREATE UNIQUE INDEX one_terminal_session ON cashier_sessions(company_id,terminal_id) WHERE status<>'CLOSED';

CREATE TABLE tax_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL, classification text NOT NULL CHECK(classification IN ('TAXABLE','ZERO_RATED','EXEMPT','NON_TAXABLE')),
 UNIQUE(company_id,code)
);

CREATE TABLE taxes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL, tax_type text NOT NULL, active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,code)
);

CREATE TABLE tax_rates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 valid_from date NOT NULL, valid_to date NOT NULL, rate rate_amount NOT NULL CHECK(rate>=0), inclusive boolean NOT NULL, recoverable_fraction rate_amount NOT NULL CHECK(recoverable_fraction BETWEEN 0 AND 1), priority integer NOT NULL DEFAULT 0, CHECK(valid_to>=valid_from),
 tax_id uuid NOT NULL,
 FOREIGN KEY(company_id,tax_id) REFERENCES taxes(company_id,id),
 category_id uuid NOT NULL,
 FOREIGN KEY(company_id,category_id) REFERENCES tax_categories(company_id,id),
 input_account_id uuid,
 FOREIGN KEY(company_id,input_account_id) REFERENCES accounts(company_id,id),
 output_account_id uuid,
 FOREIGN KEY(company_id,output_account_id) REFERENCES accounts(company_id,id),
 EXCLUDE USING gist(company_id WITH =, tax_id WITH =, category_id WITH =, daterange(valid_from,valid_to,'[]') WITH &&)
);

CREATE TABLE customers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 number text NOT NULL, name text NOT NULL, phone text, email text, address text, tax_pin text, payment_terms_days integer NOT NULL DEFAULT 0 CHECK(payment_terms_days>=0), currency char(3) NOT NULL REFERENCES currencies(code), active boolean NOT NULL DEFAULT true, customer_type text NOT NULL, credit_limit money_amount NOT NULL DEFAULT 0 CHECK(credit_limit>=0), credit_hold boolean NOT NULL DEFAULT false,
 tax_category_id uuid,
 FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),
 UNIQUE(company_id,number)
);

CREATE TABLE suppliers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 number text NOT NULL, name text NOT NULL, phone text, email text, address text, tax_pin text, payment_terms_days integer NOT NULL DEFAULT 0 CHECK(payment_terms_days>=0), currency char(3) NOT NULL REFERENCES currencies(code), active boolean NOT NULL DEFAULT true, credit_terms text,
 tax_category_id uuid,
 FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),
 UNIQUE(company_id,number)
);

CREATE TABLE customer_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 customer_id uuid NOT NULL,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 control_account_id uuid NOT NULL,
 FOREIGN KEY(company_id,control_account_id) REFERENCES accounts(company_id,id),
 UNIQUE(company_id,customer_id)
);

CREATE TABLE supplier_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 supplier_id uuid NOT NULL,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 control_account_id uuid NOT NULL,
 FOREIGN KEY(company_id,control_account_id) REFERENCES accounts(company_id,id),
 UNIQUE(company_id,supplier_id)
);

CREATE TABLE product_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL,
 UNIQUE(company_id,code)
);

ALTER TABLE product_categories ADD parent_id uuid, ADD FOREIGN KEY(company_id,parent_id) REFERENCES product_categories(company_id,id);

CREATE TABLE brands(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 name text NOT NULL,
 UNIQUE(company_id,name)
);

CREATE TABLE units_of_measure(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL, quantity_scale smallint NOT NULL CHECK(quantity_scale BETWEEN 0 AND 6),
 UNIQUE(company_id,code)
);

CREATE TABLE products(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 sku text NOT NULL, product_code text NOT NULL, name text NOT NULL, description text, item_type text NOT NULL CHECK(item_type IN ('STOCK','SERVICE','NON_STOCK')), serialized boolean NOT NULL DEFAULT false, batch_controlled boolean NOT NULL DEFAULT false, expiry_controlled boolean NOT NULL DEFAULT false, purchase_price unit_amount NOT NULL DEFAULT 0 CHECK(purchase_price>=0), selling_price unit_amount NOT NULL DEFAULT 0 CHECK(selling_price>=0), reorder_level quantity_amount NOT NULL DEFAULT 0, min_stock quantity_amount NOT NULL DEFAULT 0, max_stock quantity_amount, active boolean NOT NULL DEFAULT true, CHECK(NOT expiry_controlled OR batch_controlled),
 category_id uuid NOT NULL,
 FOREIGN KEY(company_id,category_id) REFERENCES product_categories(company_id,id),
 brand_id uuid,
 FOREIGN KEY(company_id,brand_id) REFERENCES brands(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 supplier_id uuid,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 tax_category_id uuid NOT NULL,
 FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),
 UNIQUE(company_id,sku),
 UNIQUE(company_id,product_code)
);

CREATE TABLE product_uom_conversions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 factor quantity_amount NOT NULL CHECK(factor>0),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 UNIQUE(company_id,product_id,uom_id)
);

CREATE TABLE product_barcodes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 barcode text NOT NULL,
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 UNIQUE(company_id,barcode)
);

CREATE TABLE price_lists(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 name text NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code),
 UNIQUE(company_id,name)
);

CREATE TABLE product_prices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 price unit_amount NOT NULL CHECK(price>=0), min_quantity quantity_amount NOT NULL DEFAULT 1 CHECK(min_quantity>0), valid_from date NOT NULL, valid_to date, inclusive boolean NOT NULL,
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 price_list_id uuid NOT NULL,
 FOREIGN KEY(company_id,price_list_id) REFERENCES price_lists(company_id,id)
);

CREATE TABLE product_taxes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 valid_from date NOT NULL, valid_to date,
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 tax_id uuid NOT NULL,
 FOREIGN KEY(company_id,tax_id) REFERENCES taxes(company_id,id)
);

CREATE TABLE inventory_lots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 batch_number text NOT NULL, expiry_date date,
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,product_id,batch_number)
);

CREATE TABLE inventory_serials(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 serial_number text NOT NULL,
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,product_id,serial_number)
);

CREATE TABLE inventory_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 movement_type text NOT NULL CHECK(movement_type IN ('PURCHASE_RECEIPT','SALE','SALES_RETURN','SUPPLIER_RETURN','TRANSFER_OUT','TRANSFER_IN','STOCK_ADJUSTMENT','STOCK_COUNT','DAMAGE','EXPIRY','OPENING_BALANCE','VALUE_ADJUSTMENT')), source_line_id uuid NOT NULL, occurred_at timestamptz NOT NULL, quantity quantity_amount NOT NULL, base_value money_amount NOT NULL, unit_cost unit_amount NOT NULL CHECK(unit_cost>=0), approved_by uuid REFERENCES users(id), CHECK(quantity<>0 OR (movement_type='VALUE_ADJUSTMENT' AND base_value<>0)),
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 lot_id uuid,
 FOREIGN KEY(company_id,lot_id) REFERENCES inventory_lots(company_id,id),
 serial_id uuid,
 FOREIGN KEY(company_id,serial_id) REFERENCES inventory_serials(company_id,id),
 journal_id uuid NOT NULL,
 FOREIGN KEY(company_id,journal_id) REFERENCES journal_entries(company_id,id),
 UNIQUE(company_id,source_id,source_line_id,movement_type,warehouse_id)
);

ALTER TABLE inventory_movements ADD original_movement_id uuid, ADD FOREIGN KEY(company_id,original_movement_id) REFERENCES inventory_movements(company_id,id);

CREATE TABLE inventory_balances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL DEFAULT 0 CHECK(quantity>=0), base_value money_amount NOT NULL DEFAULT 0 CHECK(base_value>=0), version bigint NOT NULL DEFAULT 0, CHECK(quantity<>0 OR base_value=0),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 UNIQUE(company_id,warehouse_id,product_id)
);

CREATE TABLE stock_reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0), expires_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id)
);

CREATE TABLE valuation_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 method text NOT NULL CHECK(method IN ('WEIGHTED_AVERAGE','FIFO')), effective_from date NOT NULL, active boolean NOT NULL DEFAULT false,
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id)
);

CREATE TABLE cost_layers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 received_quantity quantity_amount NOT NULL CHECK(received_quantity>0), unit_cost unit_amount NOT NULL CHECK(unit_cost>=0),
 receipt_movement_id uuid NOT NULL,
 FOREIGN KEY(company_id,receipt_movement_id) REFERENCES inventory_movements(company_id,id)
);

CREATE TABLE cost_layer_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0), base_value money_amount NOT NULL CHECK(base_value>=0),
 layer_id uuid NOT NULL,
 FOREIGN KEY(company_id,layer_id) REFERENCES cost_layers(company_id,id),
 issue_movement_id uuid NOT NULL,
 FOREIGN KEY(company_id,issue_movement_id) REFERENCES inventory_movements(company_id,id)
);

CREATE TABLE stock_counts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 cutoff_at timestamptz NOT NULL, count_scope jsonb NOT NULL, blind boolean NOT NULL DEFAULT true,
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id)
);

CREATE TABLE stock_count_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 system_quantity quantity_amount NOT NULL, counted_quantity quantity_amount CHECK(counted_quantity>=0), counted_by uuid REFERENCES users(id), counted_at timestamptz, variance_value money_amount,
 count_id uuid NOT NULL,
 FOREIGN KEY(company_id,count_id) REFERENCES stock_counts(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 lot_id uuid,
 FOREIGN KEY(company_id,lot_id) REFERENCES inventory_lots(company_id,id)
);

CREATE TABLE stock_transfers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 dispatched_by uuid REFERENCES users(id), dispatched_at timestamptz, received_by uuid REFERENCES users(id), received_at timestamptz,
 from_warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,from_warehouse_id) REFERENCES warehouses(company_id,id),
 to_warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,to_warehouse_id) REFERENCES warehouses(company_id,id),
 transit_warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,transit_warehouse_id) REFERENCES warehouses(company_id,id),
 CHECK(from_warehouse_id<>to_warehouse_id)
);

CREATE TABLE stock_transfer_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 requested_quantity quantity_amount NOT NULL CHECK(requested_quantity>0),
 transfer_id uuid NOT NULL,
 FOREIGN KEY(company_id,transfer_id) REFERENCES stock_transfers(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id)
);

CREATE TABLE stock_transfer_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0), discrepancy_reason text,
 transfer_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,transfer_line_id) REFERENCES stock_transfer_lines(company_id,id),
 movement_id uuid NOT NULL,
 FOREIGN KEY(company_id,movement_id) REFERENCES inventory_movements(company_id,id)
);

CREATE TABLE quotations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 valid_until date, payment_terms_snapshot jsonb NOT NULL,
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id)
);

CREATE TABLE quotation_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 line_no integer NOT NULL CHECK(line_no>0), quantity quantity_amount NOT NULL CHECK(quantity>0), unit_price unit_amount NOT NULL CHECK(unit_price>=0), discount money_amount NOT NULL DEFAULT 0 CHECK(discount>=0), net money_amount NOT NULL CHECK(net>=0), tax money_amount NOT NULL CHECK(tax>=0), gross money_amount NOT NULL CHECK(gross>=0), tax_snapshot jsonb NOT NULL, CHECK(net+tax=gross),
 quotation_id uuid NOT NULL,
 FOREIGN KEY(company_id,quotation_id) REFERENCES quotations(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 UNIQUE(company_id,quotation_id,line_no)
);

CREATE TABLE sales_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 valid_until date, payment_terms_snapshot jsonb NOT NULL,
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id)
);

CREATE TABLE sales_order_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 line_no integer NOT NULL CHECK(line_no>0), quantity quantity_amount NOT NULL CHECK(quantity>0), unit_price unit_amount NOT NULL CHECK(unit_price>=0), discount money_amount NOT NULL DEFAULT 0 CHECK(discount>=0), net money_amount NOT NULL CHECK(net>=0), tax money_amount NOT NULL CHECK(tax>=0), gross money_amount NOT NULL CHECK(gross>=0), tax_snapshot jsonb NOT NULL, CHECK(net+tax=gross),
 order_id uuid NOT NULL,
 FOREIGN KEY(company_id,order_id) REFERENCES sales_orders(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 UNIQUE(company_id,order_id,line_no)
);

CREATE TABLE pos_carts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 version integer NOT NULL DEFAULT 1, state text NOT NULL CHECK(state IN ('ACTIVE','HELD','CHECKOUT_PENDING','CONVERTED','CANCELLED')), cart_snapshot jsonb NOT NULL, expires_at timestamptz,
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 session_id uuid NOT NULL,
 FOREIGN KEY(company_id,session_id) REFERENCES cashier_sessions(company_id,id)
);

CREATE TABLE sales(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 sale_type text NOT NULL CHECK(sale_type IN ('CASH','CREDIT','MIXED')), due_date date, net money_amount NOT NULL, tax money_amount NOT NULL, gross money_amount NOT NULL, CHECK(net+tax=gross), CHECK(sale_type<>'CREDIT' OR customer_id IS NOT NULL),
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 terminal_id uuid,
 FOREIGN KEY(company_id,terminal_id) REFERENCES pos_terminals(company_id,id),
 cashier_session_id uuid,
 FOREIGN KEY(company_id,cashier_session_id) REFERENCES cashier_sessions(company_id,id),
 sales_order_id uuid,
 FOREIGN KEY(company_id,sales_order_id) REFERENCES sales_orders(company_id,id)
);

CREATE TABLE sale_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 line_no integer NOT NULL CHECK(line_no>0), quantity quantity_amount NOT NULL CHECK(quantity>0), unit_price unit_amount NOT NULL CHECK(unit_price>=0), discount money_amount NOT NULL DEFAULT 0 CHECK(discount>=0), net money_amount NOT NULL CHECK(net>=0), tax money_amount NOT NULL CHECK(tax>=0), gross money_amount NOT NULL CHECK(gross>=0), tax_snapshot jsonb NOT NULL, CHECK(net+tax=gross), cogs money_amount NOT NULL CHECK(cogs>=0),
 sale_id uuid NOT NULL,
 FOREIGN KEY(company_id,sale_id) REFERENCES sales(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 UNIQUE(company_id,sale_id,line_no)
);

CREATE TABLE sales_returns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 reason text NOT NULL, disposition text NOT NULL,
 original_sale_id uuid NOT NULL,
 FOREIGN KEY(company_id,original_sale_id) REFERENCES sales(company_id,id),
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id)
);

CREATE TABLE sales_return_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0), net money_amount NOT NULL, tax money_amount NOT NULL, original_cost money_amount NOT NULL, tax_snapshot jsonb NOT NULL,
 return_id uuid NOT NULL,
 FOREIGN KEY(company_id,return_id) REFERENCES sales_returns(company_id,id),
 original_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,original_line_id) REFERENCES sale_lines(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id)
);

CREATE TABLE purchase_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 description text NOT NULL, required_on date,
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id)
);

CREATE TABLE purchase_request_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0),
 request_id uuid NOT NULL,
 FOREIGN KEY(company_id,request_id) REFERENCES purchase_requests(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id)
);

CREATE TABLE purchase_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 expected_on date, payment_terms_snapshot jsonb NOT NULL, net money_amount NOT NULL, tax money_amount NOT NULL, gross money_amount NOT NULL, CHECK(net+tax=gross),
 supplier_id uuid NOT NULL,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 request_id uuid,
 FOREIGN KEY(company_id,request_id) REFERENCES purchase_requests(company_id,id)
);

CREATE TABLE purchase_order_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 line_no integer NOT NULL CHECK(line_no>0), quantity quantity_amount NOT NULL CHECK(quantity>0), unit_price unit_amount NOT NULL CHECK(unit_price>=0), discount money_amount NOT NULL DEFAULT 0 CHECK(discount>=0), net money_amount NOT NULL CHECK(net>=0), tax money_amount NOT NULL CHECK(tax>=0), gross money_amount NOT NULL CHECK(gross>=0), tax_snapshot jsonb NOT NULL, CHECK(net+tax=gross),
 order_id uuid NOT NULL,
 FOREIGN KEY(company_id,order_id) REFERENCES purchase_orders(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 uom_id uuid NOT NULL,
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 UNIQUE(company_id,order_id,line_no)
);

CREATE TABLE grns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 delivery_reference text NOT NULL,
 order_id uuid NOT NULL,
 FOREIGN KEY(company_id,order_id) REFERENCES purchase_orders(company_id,id),
 supplier_id uuid NOT NULL,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id)
);

CREATE TABLE grn_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 accepted_quantity quantity_amount NOT NULL CHECK(accepted_quantity>=0), rejected_quantity quantity_amount NOT NULL DEFAULT 0 CHECK(rejected_quantity>=0), damaged_quantity quantity_amount NOT NULL DEFAULT 0 CHECK(damaged_quantity>=0), provisional_unit_cost unit_amount NOT NULL CHECK(provisional_unit_cost>=0),
 grn_id uuid NOT NULL,
 FOREIGN KEY(company_id,grn_id) REFERENCES grns(company_id,id),
 order_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,order_line_id) REFERENCES purchase_order_lines(company_id,id),
 product_id uuid NOT NULL,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 lot_id uuid,
 FOREIGN KEY(company_id,lot_id) REFERENCES inventory_lots(company_id,id),
 serial_id uuid,
 FOREIGN KEY(company_id,serial_id) REFERENCES inventory_serials(company_id,id)
);

CREATE TABLE supplier_invoices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 supplier_invoice_number text NOT NULL, invoice_date date NOT NULL, due_date date NOT NULL, net money_amount NOT NULL, tax money_amount NOT NULL, gross money_amount NOT NULL, CHECK(net+tax=gross),
 supplier_id uuid NOT NULL,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 UNIQUE(company_id,supplier_id,supplier_invoice_number)
);

CREATE TABLE supplier_invoice_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 line_no integer NOT NULL CHECK(line_no>0), quantity quantity_amount NOT NULL CHECK(quantity>0), unit_price unit_amount NOT NULL CHECK(unit_price>=0), discount money_amount NOT NULL DEFAULT 0 CHECK(discount>=0), net money_amount NOT NULL CHECK(net>=0), tax money_amount NOT NULL CHECK(tax>=0), gross money_amount NOT NULL CHECK(gross>=0), tax_snapshot jsonb NOT NULL, CHECK(net+tax=gross),
 invoice_id uuid NOT NULL,
 FOREIGN KEY(company_id,invoice_id) REFERENCES supplier_invoices(company_id,id),
 product_id uuid,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 expense_account_id uuid,
 FOREIGN KEY(company_id,expense_account_id) REFERENCES accounts(company_id,id),
 UNIQUE(company_id,invoice_id,line_no),
 CHECK(product_id IS NOT NULL OR expense_account_id IS NOT NULL)
);

CREATE TABLE invoice_receipt_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0), matched_value money_amount NOT NULL,
 invoice_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,invoice_line_id) REFERENCES supplier_invoice_lines(company_id,id),
 grn_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,grn_line_id) REFERENCES grn_lines(company_id,id)
);

CREATE TABLE match_tolerances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 version integer NOT NULL, quantity_percent rate_amount NOT NULL CHECK(quantity_percent>=0), price_percent rate_amount NOT NULL CHECK(price_percent>=0), tax_amount money_amount NOT NULL CHECK(tax_amount>=0), valid_from date NOT NULL
);

CREATE TABLE match_exceptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 variance_type text NOT NULL, expected numeric(20,6) NOT NULL, actual numeric(20,6) NOT NULL, decision text, decided_by uuid REFERENCES users(id), decided_at timestamptz, reason text,
 invoice_id uuid NOT NULL,
 FOREIGN KEY(company_id,invoice_id) REFERENCES supplier_invoices(company_id,id),
 tolerance_id uuid NOT NULL,
 FOREIGN KEY(company_id,tolerance_id) REFERENCES match_tolerances(company_id,id)
);

CREATE TABLE purchase_returns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 reason text NOT NULL,
 supplier_id uuid NOT NULL,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 grn_id uuid NOT NULL,
 FOREIGN KEY(company_id,grn_id) REFERENCES grns(company_id,id)
);

CREATE TABLE purchase_return_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0), base_value money_amount NOT NULL,
 return_id uuid NOT NULL,
 FOREIGN KEY(company_id,return_id) REFERENCES purchase_returns(company_id,id),
 grn_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,grn_line_id) REFERENCES grn_lines(company_id,id),
 warehouse_id uuid NOT NULL,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id)
);

CREATE TABLE partner_notes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 direction text NOT NULL CHECK(direction IN ('CUSTOMER_CREDIT','CUSTOMER_DEBIT','SUPPLIER_CREDIT','SUPPLIER_DEBIT')), net money_amount NOT NULL, tax money_amount NOT NULL, gross money_amount NOT NULL, reason text NOT NULL, CHECK(net+tax=gross), CHECK((customer_id IS NOT NULL)::int+(supplier_id IS NOT NULL)::int=1),
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 supplier_id uuid,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 original_source_id uuid NOT NULL,
 FOREIGN KEY(company_id,original_source_id) REFERENCES source_documents(company_id,id)
);

CREATE TABLE bank_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 name text NOT NULL, institution text NOT NULL, account_reference_encrypted text NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id)
);

CREATE TABLE mobile_money_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 name text NOT NULL, provider text NOT NULL, merchant_code text NOT NULL, credential_secret_ref text NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id)
);

CREATE TABLE payment_methods(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL, channel text NOT NULL, requires_verification boolean NOT NULL, active boolean NOT NULL DEFAULT true,
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 UNIQUE(company_id,code)
);

CREATE TABLE payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 direction text NOT NULL CHECK(direction IN ('RECEIPT','DISBURSEMENT')), amount money_amount NOT NULL CHECK(amount>0), currency char(3) NOT NULL REFERENCES currencies(code), exchange_rate rate_amount NOT NULL CHECK(exchange_rate>0), base_amount money_amount NOT NULL CHECK(base_amount>0), reference text, status text NOT NULL CHECK(status IN ('PENDING','SUCCESSFUL','FAILED','CANCELLED','TIMEOUT','REVERSED')), initiated_by uuid REFERENCES users(id), posted_by uuid REFERENCES users(id), posted_at timestamptz, reversed_by uuid REFERENCES users(id), reversed_at timestamptz, verification_evidence jsonb, CHECK(status<>'SUCCESSFUL' OR posted_by IS NOT NULL),
 method_id uuid NOT NULL,
 FOREIGN KEY(company_id,method_id) REFERENCES payment_methods(company_id,id),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 customer_id uuid,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 supplier_id uuid,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 cashier_session_id uuid,
 FOREIGN KEY(company_id,cashier_session_id) REFERENCES cashier_sessions(company_id,id)
);

CREATE TABLE payment_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 provider text NOT NULL, merchant_code text NOT NULL, checkout_reference text, external_receipt text, state text NOT NULL, request_hash text NOT NULL, response_redacted jsonb, verified_at timestamptz,
 payment_id uuid NOT NULL,
 FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id),
 UNIQUE(company_id,provider,merchant_code,checkout_reference),
 UNIQUE(company_id,provider,merchant_code,external_receipt)
);

CREATE TABLE integration_inbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 provider text NOT NULL, external_event_key text NOT NULL, payload_hash text NOT NULL, encrypted_payload text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, failure_reason text,
 UNIQUE(company_id,provider,external_event_key)
);

CREATE TABLE sale_payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 applied_amount money_amount NOT NULL CHECK(applied_amount>0), tendered_amount money_amount NOT NULL CHECK(tendered_amount>=applied_amount),
 sale_id uuid NOT NULL,
 FOREIGN KEY(company_id,sale_id) REFERENCES sales(company_id,id),
 payment_id uuid NOT NULL,
 FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id),
 UNIQUE(company_id,sale_id,payment_id)
);

CREATE TABLE customer_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 entry_type text NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code), debit money_amount NOT NULL DEFAULT 0, credit money_amount NOT NULL DEFAULT 0, base_debit money_amount NOT NULL DEFAULT 0, base_credit money_amount NOT NULL DEFAULT 0, due_date date, CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),
 customer_id uuid NOT NULL,
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 control_account_id uuid NOT NULL,
 FOREIGN KEY(company_id,control_account_id) REFERENCES accounts(company_id,id),
 journal_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,journal_line_id) REFERENCES journal_lines(company_id,id),
 UNIQUE(company_id,journal_line_id)
);

CREATE TABLE supplier_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 entry_type text NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code), debit money_amount NOT NULL DEFAULT 0, credit money_amount NOT NULL DEFAULT 0, base_debit money_amount NOT NULL DEFAULT 0, base_credit money_amount NOT NULL DEFAULT 0, due_date date, CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),
 supplier_id uuid NOT NULL,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 control_account_id uuid NOT NULL,
 FOREIGN KEY(company_id,control_account_id) REFERENCES accounts(company_id,id),
 journal_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,journal_line_id) REFERENCES journal_lines(company_id,id),
 UNIQUE(company_id,journal_line_id)
);

CREATE TABLE payment_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 amount money_amount NOT NULL CHECK(amount>0), base_amount money_amount NOT NULL CHECK(base_amount>0),
 payment_id uuid NOT NULL,
 FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id),
 invoice_source_id uuid NOT NULL,
 FOREIGN KEY(company_id,invoice_source_id) REFERENCES source_documents(company_id,id),
 allocation_source_id uuid NOT NULL,
 FOREIGN KEY(company_id,allocation_source_id) REFERENCES source_documents(company_id,id)
);

ALTER TABLE payment_allocations ADD reversal_of uuid, ADD FOREIGN KEY(company_id,reversal_of) REFERENCES payment_allocations(company_id,id), ADD UNIQUE(company_id,reversal_of);

CREATE TABLE settlement_statements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 provider text NOT NULL, external_reference text NOT NULL, statement_date date NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code),
 UNIQUE(company_id,provider,external_reference)
);

CREATE TABLE settlement_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 external_reference text NOT NULL, amount money_amount NOT NULL, fee money_amount NOT NULL DEFAULT 0, exception_reason text,
 statement_id uuid NOT NULL,
 FOREIGN KEY(company_id,statement_id) REFERENCES settlement_statements(company_id,id),
 payment_id uuid,
 FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id)
);

CREATE TABLE cash_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 signed_amount money_amount NOT NULL CHECK(signed_amount<>0), movement_type text NOT NULL,
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 session_id uuid,
 FOREIGN KEY(company_id,session_id) REFERENCES cashier_sessions(company_id,id),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 journal_line_id uuid NOT NULL,
 FOREIGN KEY(company_id,journal_line_id) REFERENCES journal_lines(company_id,id),
 UNIQUE(company_id,journal_line_id)
);

CREATE TABLE cash_counts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 counted_amount money_amount NOT NULL CHECK(counted_amount>=0), denomination_snapshot jsonb NOT NULL, approved_by uuid REFERENCES users(id), approved_at timestamptz, reason text,
 session_id uuid,
 FOREIGN KEY(company_id,session_id) REFERENCES cashier_sessions(company_id,id),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id)
);

CREATE TABLE cost_centers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 code text NOT NULL, name text NOT NULL,
 UNIQUE(company_id,code)
);

CREATE TABLE expense_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 name text NOT NULL,
 expense_account_id uuid NOT NULL,
 FOREIGN KEY(company_id,expense_account_id) REFERENCES accounts(company_id,id)
);

CREATE TABLE expenses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 source_id uuid NOT NULL,
 UNIQUE(company_id,source_id),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 payee_name text, description text NOT NULL, net money_amount NOT NULL, tax money_amount NOT NULL, gross money_amount NOT NULL, CHECK(net+tax=gross),
 supplier_id uuid,
 FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id),
 payment_id uuid,
 FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id)
);

CREATE TABLE expense_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 line_no integer NOT NULL CHECK(line_no>0), quantity quantity_amount NOT NULL CHECK(quantity>0), unit_price unit_amount NOT NULL CHECK(unit_price>=0), discount money_amount NOT NULL DEFAULT 0 CHECK(discount>=0), net money_amount NOT NULL CHECK(net>=0), tax money_amount NOT NULL CHECK(tax>=0), gross money_amount NOT NULL CHECK(gross>=0), tax_snapshot jsonb NOT NULL, CHECK(net+tax=gross),
 expense_id uuid NOT NULL,
 FOREIGN KEY(company_id,expense_id) REFERENCES expenses(company_id,id),
 category_id uuid NOT NULL,
 FOREIGN KEY(company_id,category_id) REFERENCES expense_categories(company_id,id),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 cost_center_id uuid,
 FOREIGN KEY(company_id,cost_center_id) REFERENCES cost_centers(company_id,id)
);

CREATE TABLE tax_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 tax_point date NOT NULL, taxable_base money_amount NOT NULL, tax_amount money_amount NOT NULL, base_tax_amount money_amount NOT NULL, rate_snapshot rate_amount NOT NULL, classification_snapshot text NOT NULL, inclusive_snapshot boolean NOT NULL, eligible_fraction_snapshot rate_amount NOT NULL CHECK(eligible_fraction_snapshot BETWEEN 0 AND 1), tax_rule_snapshot jsonb NOT NULL, source_line_id uuid NOT NULL,
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 rate_id uuid NOT NULL,
 FOREIGN KEY(company_id,rate_id) REFERENCES tax_rates(company_id,id),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 journal_line_id uuid,
 FOREIGN KEY(company_id,journal_line_id) REFERENCES journal_lines(company_id,id)
);

CREATE TABLE fiscal_submissions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 adapter text NOT NULL, version integer NOT NULL, payload_snapshot jsonb NOT NULL, payload_hash text NOT NULL, status text NOT NULL, external_reference text, fiscal_receipt jsonb, attempt_count integer NOT NULL DEFAULT 0, last_error text,
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 UNIQUE(company_id,source_id,adapter),
 UNIQUE(company_id,adapter,external_reference)
);

CREATE TABLE accounting_rule_sets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 event_type text NOT NULL, version integer NOT NULL, valid_from date NOT NULL, valid_to date, priority integer NOT NULL, approved_by uuid REFERENCES users(id), approved_at timestamptz, active boolean NOT NULL DEFAULT false,
 branch_id uuid,
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
 warehouse_id uuid,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 product_id uuid,
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 category_id uuid,
 FOREIGN KEY(company_id,category_id) REFERENCES product_categories(company_id,id),
 tax_category_id uuid,
 FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),
 payment_method_id uuid,
 FOREIGN KEY(company_id,payment_method_id) REFERENCES payment_methods(company_id,id),
 UNIQUE(company_id,event_type,version)
);

CREATE TABLE accounting_rule_legs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 leg_code text NOT NULL, side text NOT NULL CHECK(side IN ('DEBIT','CREDIT')), amount_key text NOT NULL,
 rule_set_id uuid NOT NULL,
 FOREIGN KEY(company_id,rule_set_id) REFERENCES accounting_rule_sets(company_id,id),
 account_id uuid NOT NULL,
 FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 UNIQUE(company_id,rule_set_id,leg_code)
);

CREATE TABLE approval_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 event_type text NOT NULL, version integer NOT NULL, threshold_base money_amount NOT NULL CHECK(threshold_base>=0), independent_creator boolean NOT NULL, independent_poster boolean NOT NULL, active boolean NOT NULL DEFAULT false,
 branch_id uuid,
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
 UNIQUE(company_id,event_type,version)
);

CREATE TABLE approval_steps(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 step_no integer NOT NULL CHECK(step_no>0), required_permission text NOT NULL REFERENCES permissions(code), minimum_approvers integer NOT NULL DEFAULT 1 CHECK(minimum_approvers>0),
 policy_id uuid NOT NULL,
 FOREIGN KEY(company_id,policy_id) REFERENCES approval_policies(company_id,id),
 UNIQUE(company_id,policy_id,step_no)
);

CREATE TABLE approval_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 revision integer NOT NULL, decision text NOT NULL CHECK(decision IN ('APPROVE','REJECT')), comments text NOT NULL,
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 step_id uuid NOT NULL,
 FOREIGN KEY(company_id,step_id) REFERENCES approval_steps(company_id,id),
 UNIQUE(company_id,source_id,revision,step_id,created_by)
);

CREATE TABLE attachments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 object_key text NOT NULL UNIQUE, original_name text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0), sha256 text NOT NULL, scan_status text NOT NULL CHECK(scan_status IN ('PENDING','CLEAN','REJECTED')), retained_until date, legal_hold boolean NOT NULL DEFAULT false,
 source_id uuid NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id)
);

CREATE TABLE exchange_rates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 currency char(3) NOT NULL REFERENCES currencies(code), base_currency char(3) NOT NULL REFERENCES currencies(code), effective_at timestamptz NOT NULL, rate rate_amount NOT NULL CHECK(rate>0), provider text NOT NULL,
 UNIQUE(company_id,currency,base_currency,effective_at)
);

CREATE TABLE system_configuration(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 key text NOT NULL, version integer NOT NULL, value jsonb NOT NULL, approved_by uuid REFERENCES users(id), effective_at timestamptz NOT NULL,
 UNIQUE(company_id,key,version)
);

CREATE TABLE reconciliation_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 cutoff_at timestamptz NOT NULL, snapshot_watermarks jsonb NOT NULL, status text NOT NULL, completed_at timestamptz
);

CREATE TABLE reconciliation_exceptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 check_code text NOT NULL, expected money_amount NOT NULL, actual money_amount NOT NULL, dimensions jsonb NOT NULL, resolution_source_id uuid, resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
 run_id uuid NOT NULL,
 FOREIGN KEY(company_id,run_id) REFERENCES reconciliation_runs(company_id,id),
 source_id uuid,
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 FOREIGN KEY(company_id,resolution_source_id) REFERENCES source_documents(company_id,id)
);

CREATE TABLE report_exports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 report_type text NOT NULL, filters jsonb NOT NULL, snapshot_at timestamptz NOT NULL, format text NOT NULL CHECK(format IN ('CSV','XLSX','PDF')), status text NOT NULL, object_key text, content_hash text, expires_at timestamptz
);

ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON pos_terminals USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX pos_terminals_company_created ON pos_terminals(company_id,created_at);

ALTER TABLE cashier_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON cashier_sessions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX cashier_sessions_company_created ON cashier_sessions(company_id,created_at);

ALTER TABLE tax_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON tax_categories USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX tax_categories_company_created ON tax_categories(company_id,created_at);

ALTER TABLE taxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON taxes USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX taxes_company_created ON taxes(company_id,created_at);

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON tax_rates USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX tax_rates_company_created ON tax_rates(company_id,created_at);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON customers USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX customers_company_created ON customers(company_id,created_at);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON suppliers USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX suppliers_company_created ON suppliers(company_id,created_at);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON customer_accounts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX customer_accounts_company_created ON customer_accounts(company_id,created_at);

ALTER TABLE supplier_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON supplier_accounts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX supplier_accounts_company_created ON supplier_accounts(company_id,created_at);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON product_categories USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX product_categories_company_created ON product_categories(company_id,created_at);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON brands USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX brands_company_created ON brands(company_id,created_at);

ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON units_of_measure USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX units_of_measure_company_created ON units_of_measure(company_id,created_at);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON products USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX products_company_created ON products(company_id,created_at);

ALTER TABLE product_uom_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON product_uom_conversions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX product_uom_conversions_company_created ON product_uom_conversions(company_id,created_at);

ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON product_barcodes USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX product_barcodes_company_created ON product_barcodes(company_id,created_at);

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON price_lists USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX price_lists_company_created ON price_lists(company_id,created_at);

ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON product_prices USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX product_prices_company_created ON product_prices(company_id,created_at);

ALTER TABLE product_taxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON product_taxes USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX product_taxes_company_created ON product_taxes(company_id,created_at);

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON inventory_lots USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX inventory_lots_company_created ON inventory_lots(company_id,created_at);

ALTER TABLE inventory_serials ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON inventory_serials USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX inventory_serials_company_created ON inventory_serials(company_id,created_at);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON inventory_movements USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX inventory_movements_company_created ON inventory_movements(company_id,created_at);

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON inventory_balances USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX inventory_balances_company_created ON inventory_balances(company_id,created_at);

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON stock_reservations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX stock_reservations_company_created ON stock_reservations(company_id,created_at);

ALTER TABLE valuation_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON valuation_policies USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX valuation_policies_company_created ON valuation_policies(company_id,created_at);

ALTER TABLE cost_layers ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON cost_layers USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX cost_layers_company_created ON cost_layers(company_id,created_at);

ALTER TABLE cost_layer_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON cost_layer_allocations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX cost_layer_allocations_company_created ON cost_layer_allocations(company_id,created_at);

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON stock_counts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX stock_counts_company_created ON stock_counts(company_id,created_at);

ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON stock_count_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX stock_count_lines_company_created ON stock_count_lines(company_id,created_at);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON stock_transfers USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX stock_transfers_company_created ON stock_transfers(company_id,created_at);

ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON stock_transfer_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX stock_transfer_lines_company_created ON stock_transfer_lines(company_id,created_at);

ALTER TABLE stock_transfer_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON stock_transfer_receipts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX stock_transfer_receipts_company_created ON stock_transfer_receipts(company_id,created_at);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON quotations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX quotations_company_created ON quotations(company_id,created_at);

ALTER TABLE quotation_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON quotation_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX quotation_lines_company_created ON quotation_lines(company_id,created_at);

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sales_orders USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sales_orders_company_created ON sales_orders(company_id,created_at);

ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sales_order_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sales_order_lines_company_created ON sales_order_lines(company_id,created_at);

ALTER TABLE pos_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON pos_carts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX pos_carts_company_created ON pos_carts(company_id,created_at);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sales USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sales_company_created ON sales(company_id,created_at);

ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sale_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sale_lines_company_created ON sale_lines(company_id,created_at);

ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sales_returns USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sales_returns_company_created ON sales_returns(company_id,created_at);

ALTER TABLE sales_return_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sales_return_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sales_return_lines_company_created ON sales_return_lines(company_id,created_at);

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON purchase_requests USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX purchase_requests_company_created ON purchase_requests(company_id,created_at);

ALTER TABLE purchase_request_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON purchase_request_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX purchase_request_lines_company_created ON purchase_request_lines(company_id,created_at);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON purchase_orders USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX purchase_orders_company_created ON purchase_orders(company_id,created_at);

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON purchase_order_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX purchase_order_lines_company_created ON purchase_order_lines(company_id,created_at);

ALTER TABLE grns ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON grns USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX grns_company_created ON grns(company_id,created_at);

ALTER TABLE grn_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON grn_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX grn_lines_company_created ON grn_lines(company_id,created_at);

ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON supplier_invoices USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX supplier_invoices_company_created ON supplier_invoices(company_id,created_at);

ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON supplier_invoice_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX supplier_invoice_lines_company_created ON supplier_invoice_lines(company_id,created_at);

ALTER TABLE invoice_receipt_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON invoice_receipt_allocations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX invoice_receipt_allocations_company_created ON invoice_receipt_allocations(company_id,created_at);

ALTER TABLE match_tolerances ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON match_tolerances USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX match_tolerances_company_created ON match_tolerances(company_id,created_at);

ALTER TABLE match_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON match_exceptions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX match_exceptions_company_created ON match_exceptions(company_id,created_at);

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON purchase_returns USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX purchase_returns_company_created ON purchase_returns(company_id,created_at);

ALTER TABLE purchase_return_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON purchase_return_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX purchase_return_lines_company_created ON purchase_return_lines(company_id,created_at);

ALTER TABLE partner_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON partner_notes USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX partner_notes_company_created ON partner_notes(company_id,created_at);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON bank_accounts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX bank_accounts_company_created ON bank_accounts(company_id,created_at);

ALTER TABLE mobile_money_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON mobile_money_accounts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX mobile_money_accounts_company_created ON mobile_money_accounts(company_id,created_at);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON payment_methods USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX payment_methods_company_created ON payment_methods(company_id,created_at);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON payments USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX payments_company_created ON payments(company_id,created_at);

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON payment_attempts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX payment_attempts_company_created ON payment_attempts(company_id,created_at);

ALTER TABLE integration_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON integration_inbox USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX integration_inbox_company_created ON integration_inbox(company_id,created_at);

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON sale_payments USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX sale_payments_company_created ON sale_payments(company_id,created_at);

ALTER TABLE customer_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON customer_transactions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX customer_transactions_company_created ON customer_transactions(company_id,created_at);

ALTER TABLE supplier_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON supplier_transactions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX supplier_transactions_company_created ON supplier_transactions(company_id,created_at);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON payment_allocations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX payment_allocations_company_created ON payment_allocations(company_id,created_at);

ALTER TABLE settlement_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON settlement_statements USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX settlement_statements_company_created ON settlement_statements(company_id,created_at);

ALTER TABLE settlement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON settlement_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX settlement_lines_company_created ON settlement_lines(company_id,created_at);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON cash_movements USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX cash_movements_company_created ON cash_movements(company_id,created_at);

ALTER TABLE cash_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON cash_counts USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX cash_counts_company_created ON cash_counts(company_id,created_at);

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON cost_centers USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX cost_centers_company_created ON cost_centers(company_id,created_at);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON expense_categories USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX expense_categories_company_created ON expense_categories(company_id,created_at);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON expenses USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX expenses_company_created ON expenses(company_id,created_at);

ALTER TABLE expense_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON expense_lines USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX expense_lines_company_created ON expense_lines(company_id,created_at);

ALTER TABLE tax_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON tax_transactions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX tax_transactions_company_created ON tax_transactions(company_id,created_at);

ALTER TABLE fiscal_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON fiscal_submissions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX fiscal_submissions_company_created ON fiscal_submissions(company_id,created_at);

ALTER TABLE accounting_rule_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON accounting_rule_sets USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX accounting_rule_sets_company_created ON accounting_rule_sets(company_id,created_at);

ALTER TABLE accounting_rule_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON accounting_rule_legs USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX accounting_rule_legs_company_created ON accounting_rule_legs(company_id,created_at);

ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON approval_policies USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX approval_policies_company_created ON approval_policies(company_id,created_at);

ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON approval_steps USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX approval_steps_company_created ON approval_steps(company_id,created_at);

ALTER TABLE approval_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON approval_decisions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX approval_decisions_company_created ON approval_decisions(company_id,created_at);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON attachments USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX attachments_company_created ON attachments(company_id,created_at);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON exchange_rates USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX exchange_rates_company_created ON exchange_rates(company_id,created_at);

ALTER TABLE system_configuration ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON system_configuration USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX system_configuration_company_created ON system_configuration(company_id,created_at);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON reconciliation_runs USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX reconciliation_runs_company_created ON reconciliation_runs(company_id,created_at);

ALTER TABLE reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON reconciliation_exceptions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX reconciliation_exceptions_company_created ON reconciliation_exceptions(company_id,created_at);

ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON report_exports USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());

CREATE INDEX report_exports_company_created ON report_exports(company_id,created_at);

CREATE TRIGGER inventory_movements_immutable BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER customer_transactions_immutable BEFORE UPDATE OR DELETE ON customer_transactions FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER supplier_transactions_immutable BEFORE UPDATE OR DELETE ON supplier_transactions FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER payment_allocations_immutable BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER cash_movements_immutable BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER tax_transactions_immutable BEFORE UPDATE OR DELETE ON tax_transactions FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER approval_decisions_immutable BEFORE UPDATE OR DELETE ON approval_decisions FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TRIGGER cost_layer_allocations_immutable BEFORE UPDATE OR DELETE ON cost_layer_allocations FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE INDEX customers_name_search ON customers USING gin(name gin_trgm_ops);

CREATE INDEX suppliers_name_search ON suppliers USING gin(name gin_trgm_ops);

CREATE INDEX products_name_search ON products USING gin(name gin_trgm_ops);

COMMIT;
