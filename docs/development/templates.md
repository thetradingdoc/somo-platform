# Automation Template Variables

This document lists all available template variables for use in automation email and SMS templates.

## Usage

Variables are enclosed in double curly braces: `{{variable_name}}`

Example:
```
Hello {{customer_name}}, your order {{order_id}} for ${{order_total}} has been completed!
```

## Available Variables

### Customer Variables

- **`{{customer_name}}`** - Customer's full name (falls back to email if name not available)
- **`{{customer_email}}`** - Customer's email address
- **`{{customer_phone}}`** - Customer's phone number

### Order Variables

- **`{{order_id}}`** - Order or checkout ID
- **`{{order_total}}`** - Total amount of the order (as a number, e.g., "50.00")
- **`{{order_status}}`** - Current status of the order (e.g., "completed", "pending", "cancelled")

### Merchant Variables

- **`{{merchant_name}}`** - Business/merchant name (defaults to "Your Business" if not available)
- **`{{merchant_email}}`** - Merchant's email address

## Context-Specific Variables

Additional variables may be available depending on the trigger context:

### Order Completed Trigger

When triggered by `order_completed`, the following context is available:
- `customer` - Full customer object
- `order` - Order object with all order details
- `checkout` - Checkout object

### Customer Created Trigger

When triggered by `customer_created`, the following context is available:
- `customer` - Full customer object

## Template Examples

### Order Confirmation Email

**Subject:** Order {{order_id}} Confirmation

**Body:**
```
Hi {{customer_name}}, Thank you for your order {{order_id}} for ${{order_total}}. Thanks, {{merchant_name}}
```

### Custom Variables

Pass custom variables via `context.variables` when calling `AutomationService.checkAndExecuteRules()` to use `{{custom_field}}` in templates.

## Notes

- Variables are case-sensitive: use `{{customer_name}}` not `{{Customer_Name}}`
- If a variable is not available, it will be replaced with an empty string
- All variables are automatically escaped for HTML/email safety
- For SMS templates, only the `content` field is used (no `subject` field)
