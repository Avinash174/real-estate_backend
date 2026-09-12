import { prisma } from '../../utils/prisma.js';
import { Role, LeadStatus, LeadSource, CallOutcome, PaymentStatus } from '@prisma/client';

export class ReportsService {
  /**
   * Helper to parse date filter strings (today, thisWeek, thisMonth, custom)
   */
  static parseDateFilter(preset?: string, from?: string, to?: string) {
    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date = new Date();

    if (preset === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      startDate = new Date(y.setHours(0, 0, 0, 0));
      endDate = new Date(y.setHours(23, 59, 59, 999));
    } else if (preset === 'thisWeek') {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(d.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
    } else if (preset === 'thisMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === 'lastMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (from) {
      startDate = new Date(from);
      if (to) endDate = new Date(to);
    }

    return startDate ? { gte: startDate, lte: endDate } : undefined;
  }

  /**
   * Section 22: Admin Dashboard Aggregations
   */
  static async getAdminDashboard(preset?: string, from?: string, to?: string) {
    const dateFilter = this.parseDateFilter(preset, from, to);
    const whereLead: any = dateFilter ? { createdAt: dateFilter } : {};

    const [
      totalLeads,
      newLeads,
      assignedLeads,
      visitsCount,
      bookingsCount,
      closedCount,
      lostCount,
      leadsBySource,
      leadsByStatus,
      payments,
      expenses,
    ] = await Promise.all([
      prisma.lead.count({ where: whereLead }),
      prisma.lead.count({ where: { ...whereLead, status: LeadStatus.NEW } }),
      prisma.lead.count({ where: { ...whereLead, status: LeadStatus.ASSIGNED } }),
      prisma.visit.count({ where: dateFilter ? { visitDate: dateFilter } : {} }),
      prisma.booking.count({ where: dateFilter ? { bookingDate: dateFilter } : {} }),
      prisma.lead.count({ where: { ...whereLead, status: LeadStatus.CLOSED } }),
      prisma.lead.count({ where: { ...whereLead, status: LeadStatus.LOST } }),
      prisma.lead.groupBy({
        by: ['source'],
        _count: { id: true },
        where: whereLead,
      }),
      prisma.lead.groupBy({
        by: ['status'],
        _count: { id: true },
        where: whereLead,
      }),
      prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          ...(dateFilter ? { paymentDate: dateFilter } : {}),
        },
        select: { amount: true },
      }),
      prisma.expense.findMany({
        where: dateFilter ? { date: dateFilter } : {},
        select: { amount: true },
      }),
    ]);

    const revenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const profit = revenue - totalExpenses;
    const conversionRate = totalLeads > 0 ? ((closedCount / totalLeads) * 100).toFixed(1) : 0;

    return {
      kpi: {
        totalLeads,
        newLeads,
        assignedLeads,
        visitsCount,
        bookingsCount,
        closedCount,
        lostCount,
        conversionRate: `${conversionRate}%`,
        revenue,
        expenses: totalExpenses,
        profit,
      },
      sourceDistribution: leadsBySource.map((s) => ({
        source: s.source,
        count: s._count.id,
      })),
      statusDistribution: leadsByStatus.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
    };
  }

  /**
   * Section 23: Manager Dashboard
   */
  static async getManagerDashboard(managerId: string, preset?: string, from?: string, to?: string) {
    const dateFilter = this.parseDateFilter(preset, from, to);

    // Get all executives belonging to manager
    const executives = await prisma.user.findMany({
      where: { managerId, role: Role.EXECUTIVE },
      select: { id: true, name: true, employeeId: true, status: true },
    });

    const execIds = executives.map((e) => e.id);

    // Executive performance table
    const performance = await Promise.all(
      executives.map(async (exec) => {
        const [
          assignedCount,
          calls,
          visits,
          revisits,
          bookings,
          closedCount,
          pendingFollowUps,
        ] = await Promise.all([
          prisma.lead.count({ where: { assignedExecutiveId: exec.id } }),
          prisma.call.findMany({
            where: {
              executiveId: exec.id,
              ...(dateFilter ? { createdAt: dateFilter } : {}),
            },
            select: { outcome: true },
          }),
          prisma.visit.count({
            where: {
              executiveId: exec.id,
              ...(dateFilter ? { visitDate: dateFilter } : {}),
            },
          }),
          prisma.revisit.count({
            where: {
              executiveId: exec.id,
              ...(dateFilter ? { revisitDate: dateFilter } : {}),
            },
          }),
          prisma.booking.count({
            where: {
              executiveId: exec.id,
              ...(dateFilter ? { bookingDate: dateFilter } : {}),
            },
          }),
          prisma.lead.count({
            where: {
              assignedExecutiveId: exec.id,
              status: LeadStatus.CLOSED,
            },
          }),
          prisma.followUp.count({
            where: {
              executiveId: exec.id,
              status: 'PENDING',
            },
          }),
        ]);

        const positiveCalls = calls.filter((c) => c.outcome === CallOutcome.POSITIVE).length;
        const negativeCalls = calls.filter((c) => c.outcome === CallOutcome.NEGATIVE).length;
        const unresponsiveCalls = calls.filter((c) => c.outcome === CallOutcome.UNRESPONSIVE).length;
        const conversionPercent =
          assignedCount > 0 ? ((closedCount / assignedCount) * 100).toFixed(1) : '0.0';

        return {
          executiveId: exec.id,
          name: exec.name,
          employeeId: exec.employeeId,
          status: exec.status,
          assignedLeads: assignedCount,
          totalCalls: calls.length,
          positiveCalls,
          negativeCalls,
          unresponsiveCalls,
          visits,
          revisits,
          bookings,
          closed: closedCount,
          pendingFollowUps,
          conversionPercent: `${conversionPercent}%`,
        };
      })
    );

    const teamLeadsCount = await prisma.lead.count({
      where: {
        OR: [{ assignedManagerId: managerId }, { assignedExecutiveId: { in: execIds } }],
      },
    });

    return {
      teamSummary: {
        totalExecutives: executives.length,
        teamLeads: teamLeadsCount,
      },
      executivePerformance: performance,
    };
  }

  /**
   * Section 24: Executive Dashboard
   */
  static async getExecutiveDashboard(executiveId: string) {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    const [
      assignedLeads,
      todayFollowUps,
      todayCallbacks,
      todayVisits,
      bookings,
      closedLeads,
      calls,
    ] = await Promise.all([
      prisma.lead.count({ where: { assignedExecutiveId: executiveId } }),
      prisma.followUp.count({
        where: {
          executiveId,
          followUpDate: { gte: todayStart, lte: todayEnd },
          status: 'PENDING',
        },
      }),
      prisma.callback.count({
        where: {
          assignedExecutiveId: executiveId,
          callbackDate: { gte: todayStart, lte: todayEnd },
          status: 'SCHEDULED',
        },
      }),
      prisma.visit.count({
        where: {
          executiveId,
          visitDate: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.booking.count({ where: { executiveId } }),
      prisma.lead.count({ where: { assignedExecutiveId: executiveId, status: LeadStatus.CLOSED } }),
      prisma.call.findMany({
        where: { executiveId },
        select: { outcome: true },
      }),
    ]);

    const positiveCalls = calls.filter((c) => c.outcome === CallOutcome.POSITIVE).length;
    const conversion = assignedLeads > 0 ? ((closedLeads / assignedLeads) * 100).toFixed(1) : '0';

    return {
      kpi: {
        assignedLeads,
        todayFollowUps,
        todayCallbacks,
        todayVisits,
        bookings,
        closedLeads,
        totalCalls: calls.length,
        positiveCalls,
        conversionRate: `${conversion}%`,
      },
    };
  }

  /**
   * Section 25: Source-wise Report
   */
  static async getSourceReport(preset?: string, from?: string, to?: string) {
    const dateFilter = this.parseDateFilter(preset, from, to);
    const sources = Object.values(LeadSource);

    const result = await Promise.all(
      sources.map(async (src) => {
        const where: any = { source: src };
        if (dateFilter) where.createdAt = dateFilter;

        const [leadsCount, closedCount, bookings] = await Promise.all([
          prisma.lead.count({ where }),
          prisma.lead.count({ where: { ...where, status: LeadStatus.CLOSED } }),
          prisma.booking.findMany({
            where: { lead: where },
            select: { amount: true },
          }),
        ]);

        const revenue = bookings.reduce((sum, b) => sum + b.amount, 0);
        const conversion = leadsCount > 0 ? ((closedCount / leadsCount) * 100).toFixed(1) : '0.0';

        return {
          source: src,
          totalLeads: leadsCount,
          closedLeads: closedCount,
          totalBookings: bookings.length,
          revenue,
          conversionRate: `${conversion}%`,
        };
      })
    );

    return result;
  }
}
